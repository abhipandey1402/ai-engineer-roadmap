import { useEffect, useState, type ComponentType } from 'react'
import { PlainEditor, type EditorProps } from './PlainEditor'

// Load CodeMirror once, lazily, into its own chunk. Until it resolves (and if it
// fails, e.g. offline) we render the dependency-free textarea, so the editor is
// always usable and CodeMirror never bloats the initial bundle.
let cmPromise: Promise<{ CodeMirrorEditor: ComponentType<EditorProps> }> | null = null
const loadCodeMirror = () => (cmPromise ??= import('./CodeMirrorEditor'))

/** Public editor: CodeMirror when available, textarea fallback otherwise. */
export function CodeEditor(props: EditorProps) {
  const [Cm, setCm] = useState<ComponentType<EditorProps> | null>(null)

  useEffect(() => {
    let alive = true
    loadCodeMirror()
      .then((m) => {
        if (alive) setCm(() => m.CodeMirrorEditor)
      })
      .catch(() => {
        /* stay on the textarea fallback */
      })
    return () => {
      alive = false
    }
  }, [])

  const Editor = Cm ?? PlainEditor
  return <Editor {...props} />
}
