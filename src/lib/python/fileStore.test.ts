import { describe, it, expect } from 'vitest'
import { defaultPlaygroundStore, fileReducer, uniqueName, type FileStore } from './fileStore'

const base: FileStore = {
  files: { 'a.py': '1', 'b.py': '2' },
  order: ['a.py', 'b.py'],
  active: 'a.py',
}

describe('fileReducer', () => {
  it('selects an existing file', () => {
    expect(fileReducer(base, { type: 'select', name: 'b.py' }).active).toBe('b.py')
  })

  it('ignores selecting a missing file', () => {
    expect(fileReducer(base, { type: 'select', name: 'z.py' })).toBe(base)
  })

  it('edits content of an existing file', () => {
    expect(fileReducer(base, { type: 'edit', name: 'a.py', content: 'x' }).files['a.py']).toBe('x')
  })

  it('adds a new file and makes it active', () => {
    const s = fileReducer(base, { type: 'add', name: 'c.py', content: '3' })
    expect(s.order).toEqual(['a.py', 'b.py', 'c.py'])
    expect(s.active).toBe('c.py')
    expect(s.files['c.py']).toBe('3')
  })

  it('does not clobber an existing file on add', () => {
    expect(fileReducer(base, { type: 'add', name: 'a.py' })).toBe(base)
  })

  it('renames a file, preserving content and order position', () => {
    const s = fileReducer(base, { type: 'rename', from: 'a.py', to: 'main.py' })
    expect(s.order).toEqual(['main.py', 'b.py'])
    expect(s.files['main.py']).toBe('1')
    expect(s.files['a.py']).toBeUndefined()
    expect(s.active).toBe('main.py')
  })

  it('refuses to rename onto an existing name', () => {
    expect(fileReducer(base, { type: 'rename', from: 'a.py', to: 'b.py' })).toBe(base)
  })

  it('deletes a non-active file', () => {
    const s = fileReducer(base, { type: 'delete', name: 'b.py' })
    expect(s.order).toEqual(['a.py'])
    expect(s.active).toBe('a.py')
  })

  it('selects the previous neighbor when deleting the active file', () => {
    const s = fileReducer({ ...base, active: 'b.py' }, { type: 'delete', name: 'b.py' })
    expect(s.active).toBe('a.py')
  })

  it('never deletes the last remaining file', () => {
    const one: FileStore = { files: { 'a.py': '1' }, order: ['a.py'], active: 'a.py' }
    expect(fileReducer(one, { type: 'delete', name: 'a.py' })).toBe(one)
  })
})

describe('uniqueName', () => {
  it('returns the base name (as .py) when free', () => {
    expect(uniqueName(base, 'new')).toBe('new.py')
  })

  it('suffixes on collision', () => {
    const s: FileStore = { files: { 'untitled.py': '' }, order: ['untitled.py'], active: 'untitled.py' }
    expect(uniqueName(s)).toBe('untitled_1.py')
  })

  it('ships a runnable default main.py', () => {
    expect(defaultPlaygroundStore.files['main.py']).toContain('print')
  })
})
