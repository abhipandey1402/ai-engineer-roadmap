import type { FileStore } from '../../lib/python/fileStore'

interface Props {
  store: FileStore
  onSelect: (name: string) => void
  onAdd: () => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
}

/** File tab strip for the Playground. Double-click a tab to rename. */
export function FileTabs({ store, onSelect, onAdd, onRename, onDelete }: Props) {
  return (
    <div className="py-tabs" role="tablist">
      {store.order.map((name) => {
        const active = name === store.active
        return (
          <span key={name} className={`py-tab ${active ? 'active' : ''}`}>
            <button
              className="py-tab-name"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(name)}
              onDoubleClick={() => onRename(name)}
              title="Click to open · double-click to rename"
            >
              {name}
            </button>
            {store.order.length > 1 && (
              <button
                className="py-tab-x"
                aria-label={`Delete ${name}`}
                title={`Delete ${name}`}
                onClick={() => onDelete(name)}
              >
                ×
              </button>
            )}
          </span>
        )
      })}
      <button className="py-tab-add" title="New file" onClick={onAdd}>
        + file
      </button>
    </div>
  )
}
