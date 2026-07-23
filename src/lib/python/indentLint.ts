// Real-time indentation/whitespace checker for Python. It reproduces the
// mistakes CPython would raise at parse time — TabError (mixed tabs/spaces),
// "expected an indented block", "unexpected indent", and "unindent does not
// match any outer indentation level" — so the editor can flag them inline as
// you type, point at the exact spot, and suggest the fix.
//
// It is deliberately structural (no execution). A one-pass scanner first marks
// which physical lines are continuations of a logical statement (inside open
// brackets, triple-quoted strings, or after a `\`), so multi-line literals and
// call arguments never trip the indentation rules.

export type IndentSeverity = 'error' | 'warning'

export interface IndentFix {
  from: number
  to: number
  insert: string
  label: string
}

export interface IndentDiagnostic {
  /** Document offset where the highlight starts. */
  from: number
  /** Document offset where the highlight ends. */
  to: number
  severity: IndentSeverity
  message: string
  /** A concrete edit that resolves the issue, when one can be inferred. */
  fix?: IndentFix
}

const COMPOUND_KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'for',
  'while',
  'def',
  'class',
  'try',
  'except',
  'finally',
  'with',
  'match',
  'case',
  'async',
])

/** Width of a leading-whitespace run, expanding tabs to the next multiple of 8
    (the same tab size CPython's tokenizer uses to compare indentation). */
function indentWidth(ws: string): number {
  let w = 0
  for (const ch of ws) {
    if (ch === '\t') w += 8 - (w % 8)
    else w += 1
  }
  return w
}

/** Mark each physical line as a continuation of a prior logical statement. */
function classifyContinuations(lines: string[]): boolean[] {
  const cont: boolean[] = []
  let bracket = 0
  let triple: '' | "'''" | '"""' = ''
  let backslash = false

  for (const line of lines) {
    cont.push(bracket > 0 || triple !== '' || backslash)

    let i = 0
    if (triple) {
      const close = line.indexOf(triple)
      if (close === -1) {
        backslash = false
        continue // whole line stays inside the triple-quoted string
      }
      i = close + triple.length
      triple = ''
    }
    backslash = false

    while (i < line.length) {
      const c = line[i]
      if (c === '#') break // comment runs to end of line
      if (c === "'" || c === '"') {
        const tq = line.slice(i, i + 3)
        if (tq === "'''" || tq === '"""') {
          const close = line.indexOf(tq, i + 3)
          if (close === -1) {
            triple = tq
            break // opens a multi-line string
          }
          i = close + 3
          continue
        }
        // single-line string: skip to its closing quote (or line end)
        const q = c
        i++
        while (i < line.length) {
          if (line[i] === '\\') {
            i += 2
            continue
          }
          if (line[i] === q) {
            i++
            break
          }
          i++
        }
        continue
      }
      if (c === '(' || c === '[' || c === '{') bracket++
      else if (c === ')' || c === ']' || c === '}') bracket = Math.max(0, bracket - 1)
      else if (c === '\\' && i === line.length - 1) backslash = true
      i++
    }
  }
  return cont
}

/** Strip a trailing inline comment (respecting simple string literals). */
function codeBeforeComment(line: string): string {
  let inStr: '' | "'" | '"' = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === inStr) inStr = ''
      continue
    }
    if (c === '#') return line.slice(0, i)
    if (c === "'" || c === '"') inStr = c
  }
  return line
}

interface Stmt {
  first: number // first physical line index
  last: number // last physical line index (== first unless it spans continuations)
  ws: string // leading whitespace of the first line
  width: number
  keyword: string
  endsWithColon: boolean
  isBlankOrComment: boolean
}

export function checkIndentation(code: string): IndentDiagnostic[] {
  const lines = code.split('\n')
  const lineStart: number[] = []
  let off = 0
  for (const l of lines) {
    lineStart.push(off)
    off += l.length + 1
  }

  const cont = classifyContinuations(lines)
  const out: IndentDiagnostic[] = []

  // --- Whitespace composition: tabs and tab/space mixing in indentation. ---
  for (let i = 0; i < lines.length; i++) {
    const ws = lines[i].match(/^[ \t]*/)![0]
    if (lines[i].slice(ws.length) === '') continue // blank line — ignore
    if (!ws.includes('\t')) continue

    const from = lineStart[i]
    const to = from + ws.length
    const fix: IndentFix = {
      from,
      to,
      insert: ws.replace(/\t/g, '  '),
      label: 'Convert tabs to spaces',
    }
    if (ws.includes(' ')) {
      out.push({
        from,
        to,
        severity: 'error',
        message:
          'Indentation mixes spaces and tabs — Python raises TabError here. Use spaces only (2 per level).',
        fix,
      })
    } else {
      out.push({
        from,
        to,
        severity: 'warning',
        message:
          'Tab used for indentation. This editor indents with 2 spaces — convert to spaces to avoid TabError.',
        fix,
      })
    }
  }

  // --- Group physical lines into logical statements. ---
  const stmts: Stmt[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    while (j < lines.length && cont[j]) j++
    const firstText = lines[i]
    const ws = firstText.match(/^[ \t]*/)![0]
    const body = firstText.slice(ws.length)
    const lastCode = codeBeforeComment(lines[j - 1]).trimEnd()
    const kwMatch = body.match(/^([A-Za-z_]\w*)/)
    stmts.push({
      first: i,
      last: j - 1,
      ws,
      width: indentWidth(ws),
      keyword: kwMatch ? kwMatch[1] : '',
      endsWithColon: lastCode.endsWith(':'),
      isBlankOrComment: body === '' || body.startsWith('#'),
    })
    i = j
  }

  // --- Block-structure rules over the real (non-blank/comment) statements. ---
  const levels: number[] = [0]
  let expectBlock: { keyword: string; line: number; indent: number } | null = null

  const highlight = (s: Stmt) => {
    const start = lineStart[s.first]
    const token = lines[s.first].slice(s.ws.length).match(/^\S+/)
    return { from: start, to: start + s.ws.length + (token ? token[0].length : 0) }
  }

  for (const s of stmts) {
    if (s.isBlankOrComment) continue
    const w = s.width

    if (expectBlock) {
      if (w > expectBlock.indent) {
        levels.push(w) // block opened correctly
        expectBlock = null
      } else {
        const kw = expectBlock.keyword
        const named = COMPOUND_KEYWORDS.has(kw) ? ` after '${kw}' statement` : ''
        const { from, to } = highlight(s)
        out.push({
          from,
          to,
          severity: 'error',
          message: `Expected an indented block${named} on line ${expectBlock.line + 1}. Indent this line by 2 spaces.`,
          fix: { from: lineStart[s.first], to: lineStart[s.first], insert: '  ', label: 'Indent this line' },
        })
        expectBlock = null
        handleLevel(s, w)
      }
    } else {
      handleLevel(s, w)
    }

    if (s.endsWithColon) {
      expectBlock = { keyword: s.keyword, line: s.last, indent: w }
    }
  }

  return out.sort((a, b) => a.from - b.from)

  function handleLevel(s: Stmt, w: number) {
    const top = levels[levels.length - 1]
    if (w > top) {
      const { from, to } = highlight(s)
      out.push({
        from,
        to,
        severity: 'error',
        message:
          "Unexpected indentation — the previous statement doesn't open a block (no ':' at its end). Remove the extra spaces.",
        fix: {
          from: lineStart[s.first],
          to: lineStart[s.first] + s.ws.length,
          insert: ' '.repeat(top),
          label: 'Match previous indentation',
        },
      })
      levels.push(w) // recover so we don't cascade errors on the block below
    } else if (w < top) {
      while (levels.length > 1 && levels[levels.length - 1] > w) levels.pop()
      if (levels[levels.length - 1] !== w) {
        const { from, to } = highlight(s)
        out.push({
          from,
          to,
          severity: 'error',
          message:
            'Unindent does not match any outer indentation level. Align this line with an enclosing block.',
        })
        levels.push(w) // recover at the observed level
      }
    }
  }
}
