// Pure file-store for the Playground's multi-file editor. Kept free of React so
// it can be unit-tested directly; PlaygroundApp drives it via useReducer.

export interface FileStore {
  files: Record<string, string>
  order: string[]
  active: string
}

export type FileAction =
  | { type: 'select'; name: string }
  | { type: 'edit'; name: string; content: string }
  | { type: 'add'; name: string; content?: string }
  | { type: 'rename'; from: string; to: string }
  | { type: 'delete'; name: string }

export function fileReducer(state: FileStore, action: FileAction): FileStore {
  switch (action.type) {
    case 'select':
      return state.files[action.name] !== undefined ? { ...state, active: action.name } : state

    case 'edit':
      if (state.files[action.name] === undefined) return state
      return { ...state, files: { ...state.files, [action.name]: action.content } }

    case 'add':
      if (!action.name || state.files[action.name] !== undefined) return state
      return {
        files: { ...state.files, [action.name]: action.content ?? '' },
        order: [...state.order, action.name],
        active: action.name,
      }

    case 'rename': {
      const { from, to } = action
      if (from === to || !to) return state
      if (state.files[from] === undefined || state.files[to] !== undefined) return state
      const files = { ...state.files }
      files[to] = files[from]
      delete files[from]
      return {
        files,
        order: state.order.map((n) => (n === from ? to : n)),
        active: state.active === from ? to : state.active,
      }
    }

    case 'delete': {
      // Never delete the last remaining file.
      if (state.order.length <= 1 || state.files[action.name] === undefined) return state
      const removedAt = state.order.indexOf(action.name)
      const files = { ...state.files }
      delete files[action.name]
      const order = state.order.filter((n) => n !== action.name)
      const active =
        state.active === action.name ? order[Math.max(0, removedAt - 1)] : state.active
      return { files, order, active }
    }

    default:
      return state
  }
}

/** Suggest a non-colliding `.py` filename (untitled.py, untitled_1.py, …). */
export function uniqueName(state: FileStore, base = 'untitled'): string {
  const ensurePy = (n: string) => (n.endsWith('.py') ? n : `${n}.py`)
  let candidate = ensurePy(base)
  let i = 1
  while (state.files[candidate] !== undefined) candidate = ensurePy(`${base}_${i++}`)
  return candidate
}

export const defaultPlaygroundStore: FileStore = {
  files: {
    'main.py': 'print("Hello from Pathwise 🐍")\n\nfor i in range(3):\n    print("count", i)\n',
  },
  order: ['main.py'],
  active: 'main.py',
}
