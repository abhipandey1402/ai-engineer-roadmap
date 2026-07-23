import { describe, expect, it } from 'vitest'
import { validateProjectFiles } from './files'
import { DEFAULT_LIMITS } from './protocol'

describe('validateProjectFiles', () => {
  it('returns valid files unchanged', () => {
    expect(validateProjectFiles(
      [{ path: 'src/app.py', content: 'print(1)' }],
      DEFAULT_LIMITS,
    )).toEqual([{ path: 'src/app.py', content: 'print(1)' }])
  })

  it('normalizes backslashes in relative paths', () => {
    expect(validateProjectFiles(
      [{ path: 'src\\app.py', content: 'print(1)' }],
      DEFAULT_LIMITS,
    )).toEqual([{ path: 'src/app.py', content: 'print(1)' }])
  })

  it.each([
    '../secret',
    '/etc/passwd',
    'C:\\secret.txt',
    '',
    './app.py',
    'src//app.py',
  ])('rejects invalid project path %j', (path) => {
    expect(() => validateProjectFiles([{ path, content: '' }], DEFAULT_LIMITS))
      .toThrow('Invalid project path')
  })

  it.each(['src/\0app.py', 'src/\u001fapp.py'])(
    'rejects control characters in project path %j',
    (path) => {
      expect(() => validateProjectFiles([{ path, content: '' }], DEFAULT_LIMITS))
        .toThrow('Invalid project path')
    },
  )

  it('enforces the file count limit', () => {
    expect(() => validateProjectFiles(
      [
        { path: 'one.py', content: '' },
        { path: 'two.py', content: '' },
      ],
      { ...DEFAULT_LIMITS, maxFiles: 1 },
    )).toThrow('Too many project files')
  })

  it('measures the per-file limit in UTF-8 bytes', () => {
    expect(() => validateProjectFiles(
      [{ path: 'app.py', content: '🙂' }],
      { ...DEFAULT_LIMITS, maxFileBytes: 3 },
    )).toThrow('Project file is too large')
  })

  it('enforces the total project byte limit', () => {
    expect(() => validateProjectFiles(
      [
        { path: 'one.py', content: '123' },
        { path: 'two.py', content: '456' },
      ],
      { ...DEFAULT_LIMITS, maxProjectBytes: 5 },
    )).toThrow('Project is too large')
  })
})
