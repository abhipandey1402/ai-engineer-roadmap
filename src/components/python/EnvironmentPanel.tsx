export interface EnvironmentEntry {
  id: number
  name: string
  value: string
  secret: boolean
}

interface Props {
  entries: EnvironmentEntry[]
  accessToken: string
  allowAccessToken: boolean
  onAccessTokenChange: (value: string) => void
  onAdd: () => void
  onChange: (id: number, patch: Partial<Omit<EnvironmentEntry, 'id'>>) => void
  onRemove: (id: number) => void
  onClearSecrets: () => void
}

export function EnvironmentPanel({
  entries,
  accessToken,
  allowAccessToken,
  onAccessTokenChange,
  onAdd,
  onChange,
  onRemove,
  onClearSecrets,
}: Props) {
  const hasSecrets = Boolean(accessToken) || entries.some((entry) => entry.secret && entry.value)
  return (
    <section className="environment-panel">
      <div className="environment-head">
        <div>
          <h2>Environment</h2>
          <p>Values are kept in memory and sent only to this cloud session.</p>
        </div>
        <button type="button" onClick={onClearSecrets} disabled={!hasSecrets}>
          Clear secrets
        </button>
      </div>

      {allowAccessToken && (
        <label className="environment-access">
          <span>Playground access token</span>
          <input
            type="password"
            value={accessToken}
            onChange={(event) => onAccessTokenChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}

      <div className="environment-rows">
        {entries.map((entry, index) => (
          <div className="environment-row" key={entry.id}>
            <label>
              <span className="sr-only">Variable {index + 1} name</span>
              <input
                value={entry.name}
                onChange={(event) => onChange(entry.id, { name: event.target.value })}
                placeholder="VARIABLE_NAME"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              <span className="sr-only">Variable {index + 1} value</span>
              <input
                type={entry.secret ? 'password' : 'text'}
                value={entry.value}
                onChange={(event) => onChange(entry.id, { value: event.target.value })}
                placeholder="Value"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="environment-secret">
              <input
                type="checkbox"
                checked={entry.secret}
                onChange={(event) => onChange(entry.id, { secret: event.target.checked })}
              />
              <span>Secret</span>
            </label>
            <button type="button" onClick={() => onRemove(entry.id)} aria-label={`Remove variable ${index + 1}`}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="environment-add" type="button" onClick={onAdd}>Add variable</button>
    </section>
  )
}
