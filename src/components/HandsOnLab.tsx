import { useEffect, useState } from 'react'
import type { HandsOnLab as Lab } from '../types'
import { Inline } from './Inline'

type Lang = 'python' | 'javascript'

const LANG_KEY = 'pathwise-lab-lang'
const PRACTICE_KEY = 'pathwise-practice'

function loadPractice(): Record<string, boolean> {
  try {
    const cur = localStorage.getItem(PRACTICE_KEY)
    if (cur) return JSON.parse(cur)
    // Migrate legacy practice checks once, namespacing them under ai-engineer.
    const legacy = localStorage.getItem('aie-practice')
    if (legacy) {
      const old = JSON.parse(legacy) as Record<string, boolean>
      const migrated: Record<string, boolean> = {}
      for (const k in old) migrated[`ai-engineer/${k}`] = old[k]
      return migrated
    }
    return {}
  } catch {
    return {}
  }
}

function StepCode({ code, language }: { code: string; language: Lang }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="lab-code">
      <div className="lab-code-bar">
        <span className="code-lang">{language}</span>
        <button className="code-copy" onClick={copy}>
          {copied ? 'copied ✓' : 'copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function HandsOnLab({
  lab,
  topicKey,
  labLanguages = ['python', 'javascript'],
}: {
  lab: Lab
  topicKey: string
  labLanguages?: Lang[]
}) {
  const single = labLanguages.length <= 1
  const only: Lang = labLanguages[0] ?? 'python'
  const [lang, setLang] = useState<Lang>(() =>
    single ? only : (localStorage.getItem(LANG_KEY) as Lang) || 'python',
  )
  const [practice, setPractice] = useState<Record<string, boolean>>(loadPractice)

  useEffect(() => {
    if (!single) localStorage.setItem(LANG_KEY, lang)
  }, [lang, single])

  const togglePractice = (i: number) => {
    const key = `${topicKey}:${i}`
    setPractice((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(PRACTICE_KEY, JSON.stringify(next))
      return next
    })
  }

  const practiceDone = lab.practice.filter((_, i) => practice[`${topicKey}:${i}`]).length

  return (
    <section className="lab">
      <header className="lab-head">
        <div>
          <h3>Hands-On Lab</h3>
          <p className="lab-goal">
            <Inline text={lab.goal} />
          </p>
        </div>
        {!single && (
          <div className="lang-toggle" role="group" aria-label="Code language">
            {labLanguages.map((l) => (
              <button
                key={l}
                className={lang === l ? 'active' : ''}
                onClick={() => setLang(l)}
              >
                {l === 'python' ? 'Python' : 'JavaScript'}
              </button>
            ))}
          </div>
        )}
      </header>

      <ol className="lab-steps">
        {lab.steps.map((step, i) => {
          const code = step[lang] ?? step[lang === 'python' ? 'javascript' : 'python']
          const fellBack = !step[lang] && code
          return (
            <li key={i} className="lab-step">
              <div className="lab-step-head">
                <span className="lab-step-num">{i + 1}</span>
                <h4>{step.title}</h4>
              </div>
              <p className="lab-step-text">
                <Inline text={step.explanation} />
              </p>
              {code && (
                <StepCode
                  code={code}
                  language={fellBack ? (lang === 'python' ? 'javascript' : 'python') : lang}
                />
              )}
            </li>
          )
        })}
      </ol>

      {lab.practice.length > 0 && (
        <div className="lab-practice">
          <h4>
            Practice{' '}
            <span className="lab-practice-count">
              {practiceDone}/{lab.practice.length}
            </span>
          </h4>
          <p className="lab-practice-sub">
            Do these yourself — practice is what makes it stick.
          </p>
          {lab.practice.map((task, i) => {
            const checked = !!practice[`${topicKey}:${i}`]
            return (
              <label key={i} className={`practice-task ${checked ? 'checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePractice(i)}
                />
                <span className="practice-box">{checked ? '✓' : ''}</span>
                <span className="practice-text">
                  <Inline text={task} />
                </span>
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}
