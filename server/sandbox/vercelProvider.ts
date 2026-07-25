import { createHash } from 'node:crypto'
import { Writable } from 'node:stream'
import { Sandbox } from '@vercel/sandbox'
import type {
  CloudRuntime,
  ProjectFile,
} from '../../src/lib/sandbox/protocol.js'
import { DEFAULT_LIMITS } from '../../src/lib/sandbox/protocol.js'
import {
  SandboxIndeterminateExecutionError,
  SandboxIdempotencyConflictError,
  SandboxNotFoundError,
  type SandboxCommand,
  type SandboxCommandIdempotency,
  type SandboxCommandResult,
  type SandboxHandle,
  type SandboxProvider,
} from './provider.js'
import type { SandboxCredentials } from './config.js'

const WORKSPACE = '/vercel/sandbox/workspace'
const DEFAULT_STATE_ROOT = '/vercel/sandbox/.pathwise/idempotency'
const HELPER_GRACE_MS = 5_000
const MAX_HELPER_OUTPUT_BYTES = DEFAULT_LIMITS.maxOutputBytes * 8
const FLOCK_EXECUTABLE = '/usr/bin/flock'

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
  } & Partial<SandboxCredentials>): Promise<VercelSandboxFacade>
  get(options: { name: string } & Partial<SandboxCredentials>): Promise<VercelSandboxFacade>
}

interface ProviderOptions {
  stateRoot?: string
  credentials?: SandboxCredentials
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
  maxOutputBytes: number
}

const IDEMPOTENCY_HELPER = String.raw`
const fs = require('node:fs/promises');
const process = require('node:process');
const { spawn } = require('node:child_process');

const send = (value) => process.stdout.write(JSON.stringify(value));
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMissing = (error) => isObject(error) && error.code === 'ENOENT';
const launcher = 'gate="$1"; failed="$2"; shift 2; '
  + 'i=0; while [ ! -e "$gate" ]; do i=$((i + 1)); '
  + '[ "$i" -ge 500 ] && exit 125; sleep 0.02; done; '
  + 'if ! command -v "$1" >/dev/null 2>&1; then tmp="$failed.$$"; '
  + 'printf "127" > "$tmp"; mv "$tmp" "$failed"; exit 127; fi; exec "$@"';

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
    || Object.keys(value.env).some((item) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item))
    || Object.values(value.env).some((item) => typeof item !== 'string')
    || !Number.isSafeInteger(value.timeoutMs)
    || value.timeoutMs <= 0
    || !Number.isSafeInteger(value.maxOutputBytes)
    || value.maxOutputBytes <= 0
  ) {
    throw new Error('Invalid helper payload');
  }
  return value;
}

function validClaim(value) {
  return isObject(value)
    && value.version === 1
    && value.phase === 'claimed'
    && typeof value.fingerprint === 'string'
    && Number.isSafeInteger(value.ownerPid)
    && value.ownerPid > 0;
}

function validResult(value, maxOutputBytes) {
  if (!isObject(value) || !Number.isSafeInteger(value.exitCode) || !Array.isArray(value.output)) {
    return false;
  }
  let bytes = 0;
  for (const chunk of value.output) {
    if (
      !isObject(chunk)
      || !Number.isSafeInteger(chunk.sequence)
      || chunk.sequence < 0
      || (chunk.stream !== 'stdout' && chunk.stream !== 'stderr')
      || typeof chunk.text !== 'string'
    ) return false;
    bytes += Buffer.byteLength(chunk.text, 'utf8');
    if (bytes > maxOutputBytes) return false;
  }
  return true;
}

async function readRecord(path) {
  try {
    return { kind: 'value', value: JSON.parse(await fs.readFile(path, 'utf8')) };
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' };
    return { kind: 'malformed' };
  }
}

async function atomicWrite(path, value) {
  const temporary = path + '.' + process.pid + '.' + Date.now() + '.tmp';
  const file = await fs.open(temporary, 'wx');
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await fs.rename(temporary, path);
  const directory = await fs.open(path.slice(0, path.lastIndexOf('/')), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function boundedText(buffer, remaining) {
  if (remaining <= 0) return '';
  let text = buffer.subarray(0, remaining).toString('utf8');
  while (Buffer.byteLength(text, 'utf8') > remaining) text = text.slice(0, -1);
  return text;
}

async function main() {
  const payload = parsePayload();
  const claimPath = payload.recordPath + '/claim.json';
  const startedPath = payload.recordPath + '/started.json';
  const resultPath = payload.recordPath + '/result.json';
  const gatePath = payload.recordPath + '/gate-' + process.pid;
  const failedPath = payload.recordPath + '/failed-before-start.json';

  const claim = await readRecord(claimPath);
  const started = await readRecord(startedPath);
  const persistedResult = await readRecord(resultPath);
  if (claim.kind === 'value' && validClaim(claim.value)) {
    if (claim.value.fingerprint !== payload.fingerprint) {
      send({ status: 'conflict' });
      return;
    }
    if (
      persistedResult.kind === 'value'
      && validResult(persistedResult.value, payload.maxOutputBytes)
    ) {
      send({ status: 'completed', result: persistedResult.value });
      return;
    }
  }
  if (started.kind !== 'missing') {
    send({ status: 'indeterminate' });
    return;
  }

  await fs.rm(payload.recordPath, { recursive: true, force: true });
  await fs.mkdir(payload.recordPath);
  await atomicWrite(claimPath, {
    version: 1,
    phase: 'claimed',
    fingerprint: payload.fingerprint,
    ownerPid: process.pid,
  });

  let execution;
  let launchedChild;
  try {
    let announceStarted;
    let rejectStarted;
    const startedPromise = new Promise((resolve, reject) => {
      announceStarted = resolve;
      rejectStarted = reject;
    });
    execution = new Promise((resolve, reject) => {
      let sequence = 0;
      const output = [];
      let outputBytes = 0;
      let excessive = false;
      let timedOut = false;
      let settled = false;
      let spawned = false;
      const child = spawn('/bin/sh', [
        '-c', launcher, 'pathwise-launcher', gatePath, failedPath,
        payload.executable, ...payload.args,
      ], {
        cwd: payload.cwd,
        env: {
          ...payload.env,
          PATH: '/usr/local/bin:/usr/bin:/bin',
          HOME: '/vercel/sandbox',
          TMPDIR: '/tmp',
          LANG: 'C.UTF-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      launchedChild = child;
      child.once('spawn', () => {
        spawned = true;
        announceStarted(child.pid);
      });
      const collect = (stream) => (chunk) => {
        if (excessive) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = payload.maxOutputBytes - outputBytes;
        const text = boundedText(buffer, remaining);
        if (text) {
          output.push({ sequence: sequence++, stream, text });
          outputBytes += Buffer.byteLength(text, 'utf8');
        }
        if (buffer.byteLength > remaining) {
          excessive = true;
          child.kill('SIGKILL');
        }
      };
      child.stdout.on('data', collect('stdout'));
      child.stderr.on('data', collect('stderr'));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, payload.timeoutMs);
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (spawned) reject(error);
        else rejectStarted(error);
      });
      child.once('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: excessive ? 137 : (timedOut || signal ? 124 : (code ?? 1)),
          output,
        });
      });
    });
    const childPid = await startedPromise;
    await atomicWrite(startedPath, {
      version: 1,
      phase: 'started',
      fingerprint: payload.fingerprint,
      childPid,
    });
    await fs.writeFile(gatePath, '', { flag: 'wx' });
  } catch {
    const startedAfterFailure = await readRecord(startedPath);
    const gateAfterFailure = await readRecord(gatePath);
    if (launchedChild) launchedChild.kill('SIGKILL');
    if (
      startedAfterFailure.kind === 'missing'
      && gateAfterFailure.kind === 'missing'
    ) {
      await fs.rm(payload.recordPath, { recursive: true, force: true });
      send({ status: 'error' });
      return;
    }
    send({ status: 'indeterminate' });
    return;
  }

  const result = await execution;
  const failedBeforeStart = await readRecord(failedPath);
  if (failedBeforeStart.kind !== 'missing') {
    await fs.rm(payload.recordPath, { recursive: true, force: true });
    send({ status: 'error' });
    return;
  }
  if (!validResult(result, payload.maxOutputBytes)) {
    send({ status: 'indeterminate' });
    return;
  }
  try {
    await atomicWrite(resultPath, result);
  } catch {
    send({ status: 'indeterminate' });
    return;
  }
  send({ status: 'completed', result });
}

main().catch(() => {
  send({ status: 'error' });
});
`

const PYTHON_IDEMPOTENCY_HELPER = String.raw`
import base64
import json
import os
import re
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
        and all(
            isinstance(key, str)
            and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key)
            for key in value['env']
        )
        and all(isinstance(item, str) for item in value['env'].values())
        and isinstance(value.get('timeoutMs'), int)
        and value['timeoutMs'] > 0
        and isinstance(value.get('maxOutputBytes'), int)
        and value['maxOutputBytes'] > 0
    )
    if not valid:
        raise ValueError('Invalid helper payload')
    return value

def valid_claim(value):
    return (
        isinstance(value, dict)
        and value.get('version') == 1
        and value.get('phase') == 'claimed'
        and isinstance(value.get('fingerprint'), str)
        and isinstance(value.get('ownerPid'), int)
        and value['ownerPid'] > 0
    )

def valid_result(value, maximum):
    if (
        not isinstance(value, dict)
        or not isinstance(value.get('exitCode'), int)
        or not isinstance(value.get('output'), list)
    ):
        return False
    total = 0
    for chunk in value['output']:
        if (
            not isinstance(chunk, dict)
            or not isinstance(chunk.get('sequence'), int)
            or chunk['sequence'] < 0
            or chunk.get('stream') not in ('stdout', 'stderr')
            or not isinstance(chunk.get('text'), str)
        ):
            return False
        total += len(chunk['text'].encode('utf-8'))
        if total > maximum:
            return False
    return True

def read_record(path):
    try:
        with open(path, encoding='utf-8') as file:
            return ('value', json.load(file))
    except FileNotFoundError:
        return ('missing', None)
    except Exception:
        return ('malformed', None)

def atomic_write(path, value):
    temporary = path + '.' + str(os.getpid()) + '.' + str(time.time_ns()) + '.tmp'
    with open(temporary, 'x', encoding='utf-8') as file:
        json.dump(value, file, separators=(',', ':'))
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    directory = os.open(os.path.dirname(path), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)

def bounded_text(data, remaining):
    if remaining <= 0:
        return ''
    text = data[:remaining].decode('utf-8', errors='replace')
    while len(text.encode('utf-8')) > remaining:
        text = text[:-1]
    return text

def execute(payload, gate_path, failed_path):
    environment = dict(payload['env'])
    environment.update({
        'PATH': '/usr/local/bin:/usr/bin:/bin',
        'HOME': '/vercel/sandbox',
        'TMPDIR': '/tmp',
        'LANG': 'C.UTF-8',
    })
    launcher = (
        'gate="$1"; failed="$2"; shift 2; '
        'i=0; while [ ! -e "$gate" ]; do i=$((i + 1)); '
        '[ "$i" -ge 500 ] && exit 125; sleep 0.02; done; '
        'if ! command -v "$1" >/dev/null 2>&1; then tmp="$failed.$$"; '
        'printf "127" > "$tmp"; mv "$tmp" "$failed"; exit 127; fi; exec "$@"'
    )
    child = subprocess.Popen(
        [
            '/bin/sh', '-c', launcher, 'pathwise-launcher',
            gate_path, failed_path, payload['executable'], *payload['args'],
        ],
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
    excessive = False
    output_bytes = 0
    atomic_write(payload['recordPath'] + '/started.json', {
        'version': 1,
        'phase': 'started',
        'fingerprint': payload['fingerprint'],
        'childPid': child.pid,
    })
    with open(gate_path, 'x', encoding='utf-8'):
        pass
    while selector.get_map():
        remaining = deadline - time.monotonic()
        if remaining <= 0 and child.poll() is None:
            child.kill()
            timed_out = True
        for key, _ in selector.select(max(0, min(0.05, remaining))):
            chunk = os.read(key.fileobj.fileno(), 65536)
            if chunk:
                if not excessive:
                    capacity = payload['maxOutputBytes'] - output_bytes
                    text = bounded_text(chunk, capacity)
                    if text:
                        output.append({
                            'sequence': sequence,
                            'stream': key.data,
                            'text': text,
                        })
                        sequence += 1
                        output_bytes += len(text.encode('utf-8'))
                    if len(chunk) > capacity:
                        excessive = True
                        child.kill()
            else:
                selector.unregister(key.fileobj)
    return_code = child.wait()
    return {
        'exitCode': 137 if excessive else (124 if timed_out else return_code),
        'output': output,
    }

def remove_record(path):
    shutil.rmtree(path, ignore_errors=True)

def main():
    payload = parse_payload()
    claim_path = payload['recordPath'] + '/claim.json'
    started_path = payload['recordPath'] + '/started.json'
    result_path = payload['recordPath'] + '/result.json'
    gate_path = payload['recordPath'] + '/gate-' + str(os.getpid())
    failed_path = payload['recordPath'] + '/failed-before-start.json'

    claim_kind, claim = read_record(claim_path)
    started_kind, _ = read_record(started_path)
    result_kind, persisted_result = read_record(result_path)
    if claim_kind == 'value' and valid_claim(claim):
        if claim['fingerprint'] != payload['fingerprint']:
            send({'status': 'conflict'})
            return
        if (
            result_kind == 'value'
            and valid_result(persisted_result, payload['maxOutputBytes'])
        ):
            send({'status': 'completed', 'result': persisted_result})
            return
    if started_kind != 'missing':
        send({'status': 'indeterminate'})
        return

    remove_record(payload['recordPath'])
    os.mkdir(payload['recordPath'])
    atomic_write(claim_path, {
        'version': 1,
        'phase': 'claimed',
        'fingerprint': payload['fingerprint'],
        'ownerPid': os.getpid(),
    })
    try:
        result = execute(payload, gate_path, failed_path)
    except Exception:
        if read_record(started_path)[0] == 'missing':
            remove_record(payload['recordPath'])
            send({'status': 'error'})
        else:
            send({'status': 'indeterminate'})
        return

    if read_record(failed_path)[0] != 'missing':
        remove_record(payload['recordPath'])
        send({'status': 'error'})
        return
    if not valid_result(result, payload['maxOutputBytes']):
        send({'status': 'indeterminate'})
        return
    try:
        atomic_write(result_path, result)
    except Exception:
        send({'status': 'indeterminate'})
        return
    send({'status': 'completed', 'result': result})

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

function parseCommandResult(
  value: unknown,
  maxOutputBytes = DEFAULT_LIMITS.maxOutputBytes,
): SandboxCommandResult {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.exitCode)
    || !Array.isArray(value.output)
  ) {
    throw new Error('Invalid idempotency helper result')
  }
  let outputBytes = 0
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
    outputBytes += Buffer.byteLength(chunk.text, 'utf8')
    if (outputBytes > maxOutputBytes) {
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
  if (parsed.status === 'indeterminate') {
    throw new SandboxIndeterminateExecutionError()
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
      maxOutputBytes: DEFAULT_LIMITS.maxOutputBytes,
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
    await this.sandbox.mkDir(this.stateRoot)
    const result = await this.sandbox.runCommand({
      cmd: FLOCK_EXECUTABLE,
      args: [
        '-x',
        `${this.stateRoot}/${keyDigest}.lock`,
        usesPython ? 'python3' : 'node',
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
  private readonly credentials: SandboxCredentials | undefined

  constructor(
    private readonly sdk: VercelSandboxSdkFacade = defaultSdk,
    options: ProviderOptions = {},
  ) {
    this.stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT
    this.credentials = options.credentials
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
      ...this.credentials,
    })
    return new VercelSandboxHandle(sandbox, this.stateRoot, runtime)
  }

  async get(name: string): Promise<SandboxHandle> {
    try {
      const sandbox = await this.sdk.get({
        name,
        ...this.credentials,
      })
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
