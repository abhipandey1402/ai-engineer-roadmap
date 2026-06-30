import { type KeyboardEvent } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onRun?: () => void
  placeholder?: string
  autoFocus?: boolean
  minRows?: number
  ariaLabel?: string
}

/** Plain monospace editor: Tab inserts two spaces, ⌘/Ctrl+Enter runs. */
export function CodeEditor({
  value,
  onChange,
  onRun,
  placeholder,
  autoFocus,
  minRows = 6,
  ariaLabel = 'Python code',
}: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onRun?.()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = el
      onChange(value.slice(0, s) + '  ' + value.slice(end))
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2
      })
    }
  }

  return (
    <textarea
      className="py-editor"
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoFocus={autoFocus}
      rows={Math.max(minRows, value.split('\n').length)}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
