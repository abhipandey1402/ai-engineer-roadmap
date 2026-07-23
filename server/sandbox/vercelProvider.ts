import { createHash } from 'node:crypto'
import { Writable } from 'node:stream'
import { Sandbox } from '@vercel/sandbox'
import type {
  CloudRuntime,
  ProjectFile,
} from '../../src/lib/sandbox/protocol'
import {
  SandboxIdempotencyConflictError,
  SandboxNotFoundError,
  type SandboxCommand,
  type SandboxCommandIdempotency,
  type SandboxCommandResult,
  type SandboxHandle,
  type SandboxProvider,
} from './provider'

const WORKSPACE = '/vercel/sandbox/workspace'
const DEFAULT_STATE_ROOT = '/vercel/sandbox/.pathwise/idempotency'
const HELPER_GRACE_MS = 5_000
const MAX_HELPER_OUTPUT_BYTES = 2_000_000

interface VercelRunCommandOptions {
  cmd: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  stdout?: Writable
  stderr?: Writable
  timeoutMs?: number
}

export interface VercelSandboxFacade {
  readonly name: string
  readonly runtime?: string
  mkDir(path: string): Promise<unknown>
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>
  runCommand(options: VercelRunCommandOptions): Promise<{ exitCode: number }>
  stop(): Promise<unknown>
}

export interface VercelSandboxSdkFacade {
  create(options: {
    name: string
    runtime: 'python3.13' | 'node24'
    timeout: number
    networkPolicy: 'allow-all'
  }): Promise<VercelSandboxFacade>
  get(options: { name: string }): Promise<VercelSandboxFacade>
}

interface ProviderOptions {
  stateRoot?: string
}

interface HelperPayload {
  recordPath: string
  keyDigest: string
  fingerprint: string
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

const IDEMPOTENCY_HELPER = String.raw`
const fs = require('node:fs/promises');
const process = require('node:process');
const { spawn } = require('node:child_process');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const send = (value) => process.stdout.write(JSON.stringify(value));
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMissing = (error) => isObject(error) && error.code === 'ENOENT';
const isExisting = (error) => isObject(error) && error.code === 'EEXIST';

function parsePayload() {
  const value = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'));
  if (
    !isObject(value)
    || typeof value.recordPath !== 'string'
    || typeof value.keyDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.keyDigest)
    || !value.recordPath.endsWith('/' + value.keyDigest)
    || typeof value.fingerprint !== 'string'
    || Buffer.byteLength(value.fingerprint, 'utf8') > 256
    || typeof value.executable !== 'string'
    || !Array.isArray(value.args)
    || value.args.some((item) => typeof item !== 'string')
    || typeof value.cwd !== 'string'
    || !isObject(value.env)
    || Object.values(value.env).some((item) => typeof item !== 'string')
    || !Number.isSafeInteger(value.timeoutMs)
    || value.timeoutMs <= 0
  ) {
    throw new Error('Invalid helper payload');
  }
  return value;
}

function ownerIsAlive(ownerPid) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) return false;
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    return isObject(error) && error.code !== 'ESRCH';
  }
}

async function execute(payload) {
  return new Promise((resolve, reject) => {
    let sequence = 0;
    const output = [];
    let settled = false;
    const child = spawn(payload.executable, payload.args, {
      cwd: payload.cwd,
      env: { ...process.env, ...payload.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (stream) => (chunk) => {
      output.push({ sequence: sequence++, stream, text: chunk.toString() });
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    const timer = setTimeout(() => child.kill('SIGKILL'), payload.timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: signal ? 124 : (code ?? 1), output });
    });
  });
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

async function main() {
  const payload = parsePayload();
  const claimPath = payload.recordPath + '/claim.json';
  const resultPath = payload.recordPath + '/result.json';
  await fs.mkdir(payload.recordPath.slice(0, payload.recordPath.lastIndexOf('/')), {
    recursive: true,
  });

  for (;;) {
    let owner = false;
    try {
      await fs.mkdir(payload.recordPath);
      owner = true;
    } catch (error) {
      if (!isExisting(error)) throw error;
    }

    if (owner) {
      try {
        await fs.writeFile(claimPath, JSON.stringify({
          fingerprint: payload.fingerprint,
          ownerPid: process.pid,
        }), { flag: 'wx' });
        const result = await execute(payload);
        const temporaryResultPath = payload.recordPath + '/result-' + process.pid + '.tmp';
        await fs.writeFile(temporaryResultPath, JSON.stringify(result), { flag: 'wx' });
        await fs.rename(temporaryResultPath, resultPath);
        send({ status: 'completed', result });
        return;
      } catch {
        await fs.rm(payload.recordPath, { recursive: true, force: true });
        send({ status: 'error' });
        return;
      }
    }

    let claim;
    try {
      claim = await readJson(claimPath);
    } catch (error) {
      if (isMissing(error)) {
        await sleep(10);
        continue;
      }
      await fs.rm(payload.recordPath, { recursive: true, force: true });
      continue;
    }
    if (!isObject(claim) || typeof claim.fingerprint !== 'string') {
      await fs.rm(payload.recordPath, { recursive: true, force: true });
      continue;
    }
    if (claim.fingerprint !== payload.fingerprint) {
      send({ status: 'conflict' });
      return;
    }

    try {
      const result = await readJson(resultPath);
      send({ status: 'completed', result });
      return;
    } catch (error) {
      if (!isMissing(error)) {
        await fs.rm(payload.recordPath, { recursive: true, force: true });
        continue;
      }
    }
    if (!ownerIsAlive(claim.ownerPid)) {
      await fs.rm(payload.recordPath, { recursive: true, force: true });
      continue;
    }
    await sleep(25);
  }
}

main().catch(() => send({ status: 'error' }));
`

const PYTHON_IDEMPOTENCY_HELPER = String.raw`
import base64
import json
import os
import selectors
import shutil
import subprocess
import sys
import time

def send(value):
    sys.stdout.write(json.dumps(value, separators=(',', ':')))
    sys.stdout.flush()

def parse_payload():
    encoded = sys.argv[1]
    encoded += '=' * (-len(encoded) % 4)
    value = json.loads(base64.urlsafe_b64decode(encoded).decode('utf-8'))
    valid = (
        isinstance(value, dict)
        and isinstance(value.get('recordPath'), str)
        and isinstance(value.get('keyDigest'), str)
        and len(value['keyDigest']) == 64
        and all(character in '0123456789abcdef' for character in value['keyDigest'])
        and value['recordPath'].endswith('/' + value['keyDigest'])
        and isinstance(value.get('fingerprint'), str)
        and len(value['fingerprint'].encode('utf-8')) <= 256
        and isinstance(value.get('executable'), str)
        and isinstance(value.get('args'), list)
        and all(isinstance(item, str) for item in value['args'])
        and isinstance(value.get('cwd'), str)
        and isinstance(value.get('env'), dict)
        and all(isinstance(item, str) for item in value['env'].values())
        and isinstance(value.get('timeoutMs'), int)
        and value['timeoutMs'] > 0
    )
    if not valid:
        raise ValueError('Invalid helper payload')
    return value

def owner_is_alive(owner_pid):
    if not isinstance(owner_pid, int) or owner_pid <= 0:
        return False
    try:
        os.kill(owner_pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

def execute(payload):
    environment = os.environ.copy()
    environment.update(payload['env'])
    child = subprocess.Popen(
        [payload['executable'], *payload['args']],
        cwd=payload['cwd'],
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
    selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
    deadline = time.monotonic() + payload['timeoutMs'] / 1000
    output = []
    sequence = 0
    timed_out = False
    while selector.get_map():
        remaining = deadline - time.monotonic()
        if remaining <= 0 and child.poll() is None:
            child.kill()
            timed_out = True
        for key, _ in selector.select(max(0, min(0.05, remaining))):
            chunk = os.read(key.fileobj.fileno(), 65536)
            if chunk:
                output.append({
                    'sequence': sequence,
                    'stream': key.data,
                    'text': chunk.decode('utf-8', errors='replace'),
                })
                sequence += 1
            else:
                selector.unregister(key.fileobj)
    return_code = child.wait()
    return {
        'exitCode': 124 if timed_out else return_code,
        'output': output,
    }

def read_json(path):
    with open(path, encoding='utf-8') as file:
        return json.load(file)

def remove_record(path):
    shutil.rmtree(path, ignore_errors=True)

def main():
    payload = parse_payload()
    claim_path = payload['recordPath'] + '/claim.json'
    result_path = payload['recordPath'] + '/result.json'
    os.makedirs(os.path.dirname(payload['recordPath']), exist_ok=True)
    while True:
        owner = False
        try:
            os.mkdir(payload['recordPath'])
            owner = True
        except FileExistsError:
            pass

        if owner:
            try:
                with open(claim_path, 'x', encoding='utf-8') as file:
                    json.dump({
                        'fingerprint': payload['fingerprint'],
                        'ownerPid': os.getpid(),
                    }, file)
                result = execute(payload)
                temporary_path = payload['recordPath'] + '/result-' + str(os.getpid()) + '.tmp'
                with open(temporary_path, 'x', encoding='utf-8') as file:
                    json.dump(result, file, separators=(',', ':'))
                os.replace(temporary_path, result_path)
                send({'status': 'completed', 'result': result})
                return
            except Exception:
                remove_record(payload['recordPath'])
                send({'status': 'error'})
                return

        try:
            claim = read_json(claim_path)
        except FileNotFoundError:
            time.sleep(0.01)
            continue
        except Exception:
            remove_record(payload['recordPath'])
            continue
        if not isinstance(claim, dict) or not isinstance(claim.get('fingerprint'), str):
            remove_record(payload['recordPath'])
            continue
        if claim['fingerprint'] != payload['fingerprint']:
            send({'status': 'conflict'})
            return
        try:
            result = read_json(result_path)
            send({'status': 'completed', 'result': result})
            return
        except FileNotFoundError:
            pass
        except Exception:
            remove_record(payload['recordPath'])
            continue
        if not owner_is_alive(claim.get('ownerPid')):
            remove_record(payload['recordPath'])
            continue
        time.sleep(0.025)

try:
    main()
except Exception:
    send({'status': 'error'})
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return isRecord(error)
    && isRecord(error.response)
    && error.response.status === 404
}

function validateProjectPath(path: string): void {
  const parts = path.split('/')
  if (
    path.length === 0
    || path.startsWith('/')
    || parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('Invalid project file path')
  }
}

function parseCommandResult(value: unknown): SandboxCommandResult {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.exitCode)
    || !Array.isArray(value.output)
  ) {
    throw new Error('Invalid idempotency helper result')
  }
  const output = value.output.map((chunk) => {
    if (
      !isRecord(chunk)
      || !Number.isSafeInteger(chunk.sequence)
      || (chunk.sequence as number) < 0
      || (chunk.stream !== 'stdout' && chunk.stream !== 'stderr')
      || typeof chunk.text !== 'string'
    ) {
      throw new Error('Invalid idempotency helper result')
    }
    return {
      sequence: chunk.sequence as number,
      stream: chunk.stream as 'stdout' | 'stderr',
      text: chunk.text,
    }
  })
  return { exitCode: value.exitCode as number, output }
}

function parseHelperResponse(serialized: string): SandboxCommandResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error('Invalid idempotency helper result')
  }
  if (!isRecord(parsed) || typeof parsed.status !== 'string') {
    throw new Error('Invalid idempotency helper result')
  }
  if (parsed.status === 'conflict') {
    throw new SandboxIdempotencyConflictError()
  }
  if (parsed.status === 'error') {
    throw new Error('Sandbox command execution failed')
  }
  if (parsed.status !== 'completed') {
    throw new Error('Invalid idempotency helper result')
  }
  return parseCommandResult(parsed.result)
}

class VercelSandboxHandle implements SandboxHandle {
  readonly name: string

  constructor(
    private readonly sandbox: VercelSandboxFacade,
    private readonly stateRoot: string,
    private readonly helperRuntime: 'node' | 'python',
  ) {
    this.name = sandbox.name
  }

  async writeFiles(files: ProjectFile[]): Promise<void> {
    for (const file of files) validateProjectPath(file.path)
    await this.sandbox.mkDir(WORKSPACE)
    await this.sandbox.writeFiles(files.map((file) => ({
      path: `${WORKSPACE}/${file.path}`,
      content: Buffer.from(file.content, 'utf8'),
    })))
  }

  async runIdempotent(
    command: SandboxCommand,
    idempotency: SandboxCommandIdempotency,
  ): Promise<SandboxCommandResult> {
    const keyDigest = createHash('sha256')
      .update(idempotency.key, 'utf8')
      .digest('hex')
    const payload: HelperPayload = {
      recordPath: `${this.stateRoot}/${keyDigest}`,
      keyDigest,
      fingerprint: idempotency.requestFingerprint,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      env: command.env,
      timeoutMs: command.timeoutMs,
    }
    const encodedPayload = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64url')
    let helperOutput = ''
    let helperOutputBytes = 0
    const stdout = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        helperOutputBytes += buffer.byteLength
        if (helperOutputBytes > MAX_HELPER_OUTPUT_BYTES) {
          callback(new Error('Invalid idempotency helper result'))
          return
        }
        helperOutput += buffer.toString('utf8')
        callback()
      },
    })
    const stderr = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    const usesPython = this.helperRuntime === 'python'
    const result = await this.sandbox.runCommand({
      cmd: usesPython ? 'python3' : 'node',
      args: [
        usesPython ? '-c' : '-e',
        usesPython ? PYTHON_IDEMPOTENCY_HELPER : IDEMPOTENCY_HELPER,
        encodedPayload,
      ],
      cwd: WORKSPACE,
      env: {},
      stdout,
      stderr,
      timeoutMs: command.timeoutMs + HELPER_GRACE_MS,
    })
    if (result.exitCode !== 0) {
      throw new Error('Sandbox idempotency helper failed')
    }
    return parseHelperResponse(helperOutput)
  }

  async stopIdempotent(): Promise<void> {
    try {
      await this.sandbox.stop()
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }
}

const defaultSdk: VercelSandboxSdkFacade = {
  create: (options) => Sandbox.create(options),
  get: (options) => Sandbox.get(options),
}

export class VercelSandboxProvider implements SandboxProvider {
  private readonly stateRoot: string

  constructor(
    private readonly sdk: VercelSandboxSdkFacade = defaultSdk,
    options: ProviderOptions = {},
  ) {
    this.stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT
  }

  async create(
    runtime: CloudRuntime,
    name: string,
    timeoutMs: number,
  ): Promise<SandboxHandle> {
    const sandbox = await this.sdk.create({
      name,
      runtime: runtime === 'python' ? 'python3.13' : 'node24',
      timeout: timeoutMs,
      networkPolicy: 'allow-all',
    })
    return new VercelSandboxHandle(sandbox, this.stateRoot, runtime)
  }

  async get(name: string): Promise<SandboxHandle> {
    try {
      const sandbox = await this.sdk.get({ name })
      return new VercelSandboxHandle(
        sandbox,
        this.stateRoot,
        sandbox.runtime === 'python3.13' ? 'python' : 'node',
      )
    } catch (error) {
      if (isNotFound(error)) throw new SandboxNotFoundError(name)
      throw error
    }
  }
}
