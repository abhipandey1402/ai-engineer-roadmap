import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  placeholder as placeholderExt,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentUnit } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { linter, lintGutter, lintKeymap } from '@codemirror/lint'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { checkIndentation } from '../../lib/python/indentLint'
import type { EditorProps } from './PlainEditor'

// Live indentation/whitespace diagnostics. Underlines the offending spot, shows
// the fix in a hover tooltip + gutter marker, and (where clear) a one-click fix.
const indentLinter = linter(
  (view) => {
    const code = view.state.doc.toString()
    const len = code.length
    return checkIndentation(code).map((d) => ({
      from: Math.min(d.from, len),
      to: Math.min(Math.max(d.to, d.from), len),
      severity: d.severity,
      message: d.message,
      actions: d.fix
        ? [
            {
              name: d.fix.label,
              apply(v: EditorView) {
                v.dispatch({ changes: { from: d.fix!.from, to: d.fix!.to, insert: d.fix!.insert } })
              },
            },
          ]
        : undefined,
    }))
  },
  { delay: 300 },
)

// The code surface is dark in both app themes (--code-bg), so one dark theme is
// correct everywhere; we just re-skin oneDark to the app's tokens.
const appTheme = (minHeight: string) =>
  EditorView.theme(
    {
      '&': { backgroundColor: 'var(--code-bg)', color: 'var(--code-fg)', minHeight },
      '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '14.5px', lineHeight: '1.6' },
      '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--gray-4)', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.045)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--gray-5)' },
      '&.cm-focused': { outline: 'none' },
      '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent-bright)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(255,255,255,0.14)',
      },
    },
    { dark: true },
  )

/** CodeMirror 6 editor: Python syntax highlighting, line numbers, auto-indent,
    bracket matching, ⌘/Ctrl+Enter to run. Loaded lazily by {@link CodeEditor}. */
export function CodeMirrorEditor({
  value,
  onChange,
  onRun,
  placeholder,
  autoFocus,
  minRows = 6,
  ariaLabel = 'Python code',
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Keep the latest callbacks reachable without recreating the editor. Updated
  // in an effect (not during render) so editor callbacks always see fresh props.
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  useEffect(() => {
    onChangeRef.current = onChange
    onRunRef.current = onRun
  })

  useEffect(() => {
    const parent = host.current
    if (!parent) return

    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          onRunRef.current?.()
          return true
        },
      },
    ])

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      bracketMatching(),
      closeBrackets(),
      // Suggest identifiers already written in the buffer (variables, funcs,
      // classes, imports) plus Python builtins/keywords. python() registers the
      // local + global completion sources; this turns the popup on.
      autocompletion({ activateOnTyping: true, closeOnBlur: true }),
      indentLinter,
      lintGutter(),
      indentUnit.of('  '),
      EditorView.lineWrapping,
      runKeymap,
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      python(),
      oneDark,
      appTheme(`${(minRows * 1.6).toFixed(1)}em`),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString())
      }),
    ]
    if (placeholder) extensions.push(placeholderExt(placeholder))

    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent })
    viewRef.current = view
    if (autoFocus) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Create once; external value changes are synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect external value changes (e.g. the Reset button) into the document.
  useEffect(() => {
    const view = viewRef.current
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  return <div className="py-cm" ref={host} />
}
