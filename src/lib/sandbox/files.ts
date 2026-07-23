import type { ProjectFile } from './protocol'

interface ProjectFileLimits {
  maxFiles: number
  maxFileBytes: number
  maxProjectBytes: number
}

const encoder = new TextEncoder()
const windowsAbsolutePath = /^[A-Za-z]:\//

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function normalizeProjectPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/')

  if (
    normalized === ''
    || normalized.startsWith('/')
    || windowsAbsolutePath.test(normalized)
    || hasControlCharacter(normalized)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid project path')
  }

  return normalized
}

export function validateProjectFiles(
  files: ProjectFile[],
  limits: ProjectFileLimits,
): ProjectFile[] {
  if (files.length > limits.maxFiles) throw new Error('Too many project files')

  let projectBytes = 0
  return files.map((file) => {
    const fileBytes = encoder.encode(file.content).byteLength
    if (fileBytes > limits.maxFileBytes) throw new Error('Project file is too large')

    projectBytes += fileBytes
    if (projectBytes > limits.maxProjectBytes) throw new Error('Project is too large')

    return {
      path: normalizeProjectPath(file.path),
      content: file.content,
    }
  })
}
