import type {
  PlaygroundRuntime,
  RuntimeCapabilities,
} from '../../lib/sandbox/protocol'
import type { SandboxState } from '../../hooks/useSandbox'

interface Props {
  value: PlaygroundRuntime
  capabilities?: RuntimeCapabilities
  cloudState: SandboxState
  disabled?: boolean
  onChange: (runtime: PlaygroundRuntime) => void
}

const runtimes: Array<{
  value: PlaygroundRuntime
  name: string
  detail: string
}> = [
  { value: 'browser-python', name: 'Browser Python', detail: 'Fast · this tab' },
  { value: 'cloud-python', name: 'Cloud Python', detail: 'Python 3.13 · Linux' },
  { value: 'cloud-node', name: 'Cloud Node', detail: 'Node.js 24 · Linux' },
]

export function RuntimeSelector({
  value,
  capabilities,
  cloudState,
  disabled = false,
  onChange,
}: Props) {
  return (
    <section className="runtime-selector" aria-label="Choose runtime">
      <div className="runtime-rail" role="radiogroup" aria-label="Runtime">
        {runtimes.map((runtime) => {
          const cloud = runtime.value !== 'browser-python'
          const supported = !cloud || capabilities?.enabled !== false
          const selected = value === runtime.value
          const status = !cloud
            ? 'Always available'
            : capabilities === undefined
              ? 'Checking availability'
              : !supported
                ? 'Setup required'
                : selected
                  ? cloudState
                  : 'Available'
          return (
            <button
              key={runtime.value}
              type="button"
              className={`runtime-option ${selected ? 'active' : ''}`}
              role="radio"
              aria-checked={selected}
              aria-disabled={!supported || disabled}
              disabled={disabled}
              onClick={() => supported && !disabled && onChange(runtime.value)}
            >
              <span className="runtime-marker" aria-hidden="true" />
              <span className="runtime-name">{runtime.name}</span>
              <span className="runtime-detail">{runtime.detail}</span>
              <span className="runtime-status">{status}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
