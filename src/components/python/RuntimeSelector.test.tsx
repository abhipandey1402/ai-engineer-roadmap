import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIMITS } from '../../lib/sandbox/protocol'
import { RuntimeSelector } from './RuntimeSelector'

describe('RuntimeSelector', () => {
  it('renders unsupported cloud choices as disabled buttons', () => {
    const markup = renderToStaticMarkup(
      <RuntimeSelector
        value="browser-python"
        capabilities={{
          enabled: false,
          reason: 'Cloud runtimes require server setup.',
          runtimes: [],
          allowByok: false,
          limits: DEFAULT_LIMITS,
        }}
        cloudState="disabled"
        onChange={vi.fn()}
      />,
    )

    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(
      ([button]) => button,
    )
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).not.toContain('disabled=""')
    expect(buttons[1]).toContain('disabled=""')
    expect(buttons[2]).toContain('disabled=""')
  })

  it('disables every runtime choice during a transient transition', () => {
    const markup = renderToStaticMarkup(
      <RuntimeSelector
        value="cloud-python"
        capabilities={{
          enabled: true,
          runtimes: ['python', 'node'],
          allowByok: false,
          limits: DEFAULT_LIMITS,
        }}
        cloudState="stopping"
        disabled
        onChange={vi.fn()}
      />,
    )

    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(
      ([button]) => button,
    )
    expect(buttons).toHaveLength(3)
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true)
  })
})
