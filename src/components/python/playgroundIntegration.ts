import { CLOUD_PLAYGROUND_HANDOFF_KEY } from '../../lib/python/browserPackageFallback'
import type {
  ExecuteCommand,
  ProjectFile,
} from '../../lib/sandbox/protocol'
import type { EnvironmentEntry } from './EnvironmentPanel'

export function getEnvironmentPresentation(allowByok: boolean) {
  return {
    showAccessToken: true,
    allowSecrets: allowByok,
    secretNotice: allowByok
      ? undefined
      : 'Owner-provided secrets are disabled for this playground. Ordinary environment variables are still available.',
  }
}

interface HandoffStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
}

export function consumeCloudHandoff(storage: HandoffStorage): string | null {
  try {
    return storage.getItem(CLOUD_PLAYGROUND_HANDOFF_KEY)
  } finally {
    storage.removeItem(CLOUD_PLAYGROUND_HANDOFF_KEY)
  }
}

export function buildCloudEnvironment(
  entries: EnvironmentEntry[],
  allowByok: boolean,
): {
  environment: Record<string, string>
  secretNames: string[]
} {
  const allowedEntries = entries.filter(
    (entry) => (!entry.secret || allowByok) && entry.name.trim(),
  )
  return {
    environment: Object.fromEntries(
      allowedEntries.map((entry) => [entry.name.trim(), entry.value]),
    ),
    secretNames: allowedEntries
      .filter((entry) => entry.secret)
      .map((entry) => entry.name.trim()),
  }
}

interface MutableBusy {
  current: boolean
}

interface CloudProjectDependencies {
  files: ProjectFile[]
  command: ExecuteCommand
  runFiles: (files: ProjectFile[]) => Promise<boolean>
  runCommand: (command: ExecuteCommand) => Promise<unknown>
  busy: MutableBusy
  onSyncingChange: (syncing: boolean) => void
}

export async function runCloudProject({
  files,
  command,
  runFiles,
  runCommand,
  busy,
  onSyncingChange,
}: CloudProjectDependencies): Promise<boolean> {
  if (busy.current) return false
  busy.current = true
  onSyncingChange(true)
  let syncing = true
  try {
    const synchronized = await runFiles(files)
    onSyncingChange(false)
    syncing = false
    if (!synchronized) return false
    await runCommand(command)
    return true
  } finally {
    busy.current = false
    if (syncing) onSyncingChange(false)
  }
}
