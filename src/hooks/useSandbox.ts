import {
  useCallback,
  useEffect,
  useReducer,
  useState,
} from 'react'
import {
  RuntimeClientError,
  SandboxClient,
} from '../lib/sandbox/client'
import type {
  CloudRuntime,
  CommandOutputChunk,
  CommandResult,
  ExecuteCommand,
  ProjectFile,
  RuntimeCapabilities,
  SessionState,
} from '../lib/sandbox/protocol'

export type SandboxState = 'loading' | SessionState

export interface SandboxSnapshot {
  capabilities: RuntimeCapabilities | undefined
  state: SandboxState
  output: CommandOutputChunk[]
  error: string | undefined
}

type SandboxAction =
  | { type: 'loading' }
  | { type: 'capabilities'; capabilities: RuntimeCapabilities }
  | { type: 'state'; state: SessionState }
  | { type: 'append'; output: CommandOutputChunk[] }
  | { type: 'clear-output' }
  | { type: 'error'; message: string }

export const initialSandboxSnapshot: SandboxSnapshot = {
  capabilities: undefined,
  state: 'loading',
  output: [],
  error: undefined,
}

export function sandboxReducer(
  state: SandboxSnapshot,
  action: SandboxAction,
): SandboxSnapshot {
  switch (action.type) {
    case 'loading':
      return { ...state, state: 'loading', error: undefined }
    case 'capabilities':
      return {
        ...state,
        capabilities: action.capabilities,
        state: action.capabilities.enabled ? 'idle' : 'disabled',
        error: undefined,
      }
    case 'state':
      return { ...state, state: action.state, error: undefined }
    case 'append':
      return { ...state, output: [...state.output, ...action.output] }
    case 'clear-output':
      return { ...state, output: [] }
    case 'error':
      return { ...state, state: 'error', error: action.message }
  }
}

export interface SandboxCredentials {
  accessToken: string
  environment: Record<string, string>
  secretNames: string[]
}

type SandboxDispatch = (action: SandboxAction) => void

const REQUEST_FAILED_MESSAGE = 'The runtime request failed.'

function safeErrorMessage(error: unknown): string {
  return error instanceof RuntimeClientError
    ? error.message
    : REQUEST_FAILED_MESSAGE
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

function copyCredentials(credentials: SandboxCredentials): SandboxCredentials {
  return {
    accessToken: credentials.accessToken,
    environment: { ...credentials.environment },
    secretNames: [...credentials.secretNames],
  }
}

export class SandboxController {
  private readonly client: SandboxClient
  private readonly dispatch: SandboxDispatch
  private readonly onSecretsCleared: () => void
  private runtime: CloudRuntime
  private credentials: SandboxCredentials
  private capabilities: RuntimeCapabilities | undefined
  private capabilitiesPromise: Promise<RuntimeCapabilities> | undefined
  private files: ProjectFile[] = []
  private sessionCreated = false
  private creationPromise: Promise<void> | undefined
  private transitionPromise: Promise<void> = Promise.resolve()
  private abortControllers = new Set<AbortController>()
  private disposed = false
  private lifecycleGeneration = 0
  private notificationGeneration = 0

  constructor(
    client: SandboxClient,
    runtime: CloudRuntime,
    credentials: SandboxCredentials,
    dispatch: SandboxDispatch,
    onSecretsCleared: () => void = () => {},
  ) {
    this.client = client
    this.dispatch = dispatch
    this.onSecretsCleared = onSecretsCleared
    this.runtime = runtime
    this.credentials = copyCredentials(credentials)
  }

  activate(): void {
    this.disposed = false
    this.notificationGeneration += 1
  }

  async loadCapabilities(): Promise<void> {
    const generation = this.lifecycleGeneration
    this.send({ type: 'loading' })
    if (this.capabilities) {
      this.send({ type: 'capabilities', capabilities: this.capabilities })
      return
    }
    try {
      await this.ensureCapabilities()
    } catch (error) {
      this.failIfCurrent(generation, error)
    }
  }

  async updateConfiguration(
    runtime: CloudRuntime,
    credentials: SandboxCredentials,
  ): Promise<void> {
    if (runtime === this.runtime) {
      this.credentials = copyCredentials(credentials)
      return
    }

    this.abortAll()
    this.lifecycleGeneration += 1
    const generation = this.lifecycleGeneration
    const oldAccessToken = this.credentials.accessToken
    this.sessionCreated = false
    this.runtime = runtime
    this.credentials = copyCredentials(credentials)
    this.send({ type: 'state', state: 'stopping' })
    const transition = this.queueTransition(
      () => this.client.destroy(oldAccessToken),
    )
    try {
      await transition
      if (this.isCurrent(generation)) {
        this.send({ type: 'state', state: 'idle' })
      }
    } catch (error) {
      this.failIfCurrent(generation, error)
    }
  }

  async runFiles(files: ProjectFile[]): Promise<void> {
    this.files = files.map((file) => ({ ...file }))
    const generation = this.lifecycleGeneration
    try {
      await this.prepareOperation(generation)
      await this.ensureSession(generation)
      await this.client.syncFiles(this.files, this.credentials.accessToken)
      this.assertCurrent(generation)
      this.send({ type: 'state', state: 'ready' })
    } catch (error) {
      if (!this.isCurrent(generation)) return
      if (this.isExpired(error)) {
        try {
          await this.recreateAndResync(generation)
          return
        } catch (recoveryError) {
          this.failIfCurrent(generation, recoveryError)
          return
        }
      }
      this.failIfCurrent(generation, error)
    }
  }

  async runCommand(
    command: ExecuteCommand,
  ): Promise<CommandResult | undefined> {
    const generation = this.lifecycleGeneration
    try {
      await this.prepareOperation(generation)
      await this.ensureSession(generation)
    } catch (error) {
      this.failIfCurrent(generation, error)
      return undefined
    }

    const abortController = new AbortController()
    this.abortControllers.add(abortController)
    this.send({ type: 'state', state: 'running' })
    try {
      let result: CommandResult
      try {
        result = await this.execute(command, abortController.signal)
      } catch (error) {
        if (
          !this.isCurrent(generation)
          || !this.isExpired(error)
          || abortController.signal.aborted
        ) {
          throw error
        }
        await this.recreateAndResync(generation)
        this.send({ type: 'state', state: 'running' })
        result = await this.execute(command, abortController.signal)
      }
      this.assertCurrent(generation)
      this.send({
        type: 'append',
        output: [...result.output].sort(
          (left, right) => left.sequence - right.sequence,
        ),
      })
      this.send({ type: 'state', state: 'ready' })
      return result
    } catch (error) {
      this.failIfCurrent(generation, error)
      return undefined
    } finally {
      this.abortControllers.delete(abortController)
    }
  }

  async stop(): Promise<void> {
    this.abortAll()
    this.lifecycleGeneration += 1
    const generation = this.lifecycleGeneration
    const accessToken = this.credentials.accessToken
    this.sessionCreated = false
    this.send({ type: 'state', state: 'stopping' })
    const transition = this.queueTransition(
      () => this.client.stop(accessToken),
    )
    try {
      await transition
      if (this.isCurrent(generation)) {
        this.send({ type: 'state', state: 'idle' })
      }
    } catch (error) {
      this.failIfCurrent(generation, error)
    }
  }

  async restart(): Promise<void> {
    this.abortAll()
    this.lifecycleGeneration += 1
    const generation = this.lifecycleGeneration
    const accessToken = this.credentials.accessToken
    this.sessionCreated = false
    this.send({ type: 'state', state: 'stopping' })
    const transition = this.queueTransition(
      () => this.client.destroy(accessToken),
    )
    try {
      await transition
      await this.prepareOperation(generation)
      await this.recreateAndResync(generation)
    } catch (error) {
      this.failIfCurrent(generation, error)
    }
  }

  async destroy(): Promise<void> {
    this.abortAll()
    this.lifecycleGeneration += 1
    const generation = this.lifecycleGeneration
    const accessToken = this.credentials.accessToken
    this.sessionCreated = false
    this.clearSensitiveValues(true)
    this.send({ type: 'state', state: 'stopping' })
    const transition = this.queueTransition(
      () => this.client.destroy(accessToken),
    )
    try {
      await transition
      if (this.isCurrent(generation)) {
        this.send({ type: 'state', state: 'idle' })
      }
    } catch (error) {
      this.failIfCurrent(generation, error)
    }
  }

  clearOutput(): void {
    this.send({ type: 'clear-output' })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.abortAll()
    this.lifecycleGeneration += 1
    const accessToken = this.credentials.accessToken
    const shouldDestroy = this.sessionCreated || this.creationPromise !== undefined
    this.sessionCreated = false
    this.clearSensitiveValues(false)
    const notificationGeneration = ++this.notificationGeneration
    queueMicrotask(() => {
      if (
        this.disposed
        && notificationGeneration === this.notificationGeneration
      ) {
        this.notifySecretsCleared()
      }
    })
    if (shouldDestroy) {
      const transition = this.queueTransition(
        () => this.client.destroy(accessToken),
      )
      try {
        await transition
      } catch {
        // Unmount cleanup cannot safely expose an asynchronous failure.
      }
    }
  }

  private async ensureCapabilities(): Promise<RuntimeCapabilities> {
    if (this.capabilities) return this.capabilities
    if (!this.capabilitiesPromise) {
      const request = this.client.capabilities().then((capabilities) => {
        this.capabilities = capabilities
        this.send({ type: 'capabilities', capabilities })
        return capabilities
      })
      this.capabilitiesPromise = request
      void request.catch(() => {
        if (this.capabilitiesPromise === request) {
          this.capabilitiesPromise = undefined
        }
      })
    }
    return this.capabilitiesPromise
  }

  private async prepareOperation(
    expectedGeneration?: number,
  ): Promise<number> {
    await this.transitionPromise
    const generation = expectedGeneration ?? this.lifecycleGeneration
    this.assertCurrent(generation)
    const capabilities = await this.ensureCapabilities()
    this.assertCurrent(generation)
    if (!capabilities.enabled) {
      throw new RuntimeClientError(
        'CLOUD_DISABLED',
        capabilities.reason,
        503,
      )
    }
    if (!capabilities.runtimes.includes(this.runtime)) {
      throw new RuntimeClientError(
        'COMMAND_REJECTED',
        'Select a supported cloud runtime.',
        400,
      )
    }
    return generation
  }

  private async ensureSession(generation: number): Promise<void> {
    this.assertCurrent(generation)
    if (this.sessionCreated) return
    if (this.creationPromise) {
      await this.creationPromise
      this.assertCurrent(generation)
      return
    }
    this.send({ type: 'state', state: 'creating' })
    const runtime = this.runtime
    const accessToken = this.credentials.accessToken
    const creation = (async () => {
      await this.client.create(runtime, accessToken)
      this.assertCurrent(generation)
      this.sessionCreated = true
      this.send({ type: 'state', state: 'ready' })
    })()
    this.creationPromise = creation
    try {
      await creation
    } finally {
      if (this.creationPromise === creation) {
        this.creationPromise = undefined
      }
    }
  }

  private async recreateAndResync(generation: number): Promise<void> {
    this.assertCurrent(generation)
    this.sessionCreated = false
    await this.ensureSession(generation)
    if (this.files.length > 0) {
      await this.client.syncFiles(this.files, this.credentials.accessToken)
      this.assertCurrent(generation)
    }
    this.send({ type: 'state', state: 'ready' })
  }

  private execute(
    command: ExecuteCommand,
    signal: AbortSignal,
  ): Promise<CommandResult> {
    return this.client.run(
      command,
      this.credentials.environment,
      this.credentials.secretNames,
      this.credentials.accessToken,
      signal,
    )
  }

  private isExpired(error: unknown): boolean {
    return error instanceof RuntimeClientError
      && error.code === 'SESSION_EXPIRED'
  }

  private abortAll(): void {
    for (const controller of this.abortControllers) controller.abort()
    this.abortControllers.clear()
  }

  private queueTransition(operation: () => Promise<void>): Promise<void> {
    const previousTransition = this.transitionPromise
    const pendingCreation = this.creationPromise
    const transition = (async () => {
      await previousTransition
      if (pendingCreation) {
        try {
          await pendingCreation
        } catch {
          // The invalidated creator is expected to reject as aborted.
        }
      }
      await operation()
    })()
    this.transitionPromise = transition.then(
      () => undefined,
      () => undefined,
    )
    return transition
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.lifecycleGeneration
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
  }

  private clearSensitiveValues(notify: boolean): void {
    this.credentials = {
      accessToken: '',
      environment: {},
      secretNames: [],
    }
    if (notify) this.notifySecretsCleared()
  }

  private notifySecretsCleared(): void {
    try {
      this.onSecretsCleared()
    } catch {
      // Consumer cleanup must not prevent sandbox destruction.
    }
  }

  private fail(error: unknown): void {
    this.send({ type: 'error', message: safeErrorMessage(error) })
  }

  private failIfCurrent(generation: number, error: unknown): void {
    if (this.isCurrent(generation) && !isAbortError(error)) {
      this.fail(error)
    }
  }

  private send(action: SandboxAction): void {
    if (!this.disposed) this.dispatch(action)
  }
}

export interface UseSandboxOptions extends SandboxCredentials {
  runtime: CloudRuntime
  client?: SandboxClient
  onSecretsCleared?: () => void
}

const defaultClient = new SandboxClient()

export function useSandbox({
  runtime,
  accessToken,
  environment,
  secretNames,
  client = defaultClient,
  onSecretsCleared,
}: UseSandboxOptions) {
  const [snapshot, dispatch] = useReducer(
    sandboxReducer,
    initialSandboxSnapshot,
  )
  const [controller] = useState(
    () => new SandboxController(
      client,
      runtime,
      { accessToken, environment, secretNames },
      dispatch,
      onSecretsCleared,
    ),
  )

  useEffect(() => {
    controller.activate()
    void controller.loadCapabilities()
    return () => {
      void controller.dispose()
    }
  }, [controller])

  useEffect(() => {
    void controller.updateConfiguration(runtime, {
      accessToken,
      environment,
      secretNames,
    })
  }, [
    accessToken,
    controller,
    environment,
    runtime,
    secretNames,
  ])

  const runFiles = useCallback(
    (files: ProjectFile[]) => controller.runFiles(files),
    [controller],
  )
  const runCommand = useCallback(
    (command: ExecuteCommand) => controller.runCommand(command),
    [controller],
  )
  const stop = useCallback(() => controller.stop(), [controller])
  const restart = useCallback(() => controller.restart(), [controller])
  const destroy = useCallback(() => controller.destroy(), [controller])
  const clearOutput = useCallback(
    () => controller.clearOutput(),
    [controller],
  )

  return {
    capabilities: snapshot.capabilities,
    state: snapshot.state,
    output: snapshot.output,
    error: snapshot.error,
    runFiles,
    runCommand,
    stop,
    restart,
    destroy,
    clearOutput,
  }
}
