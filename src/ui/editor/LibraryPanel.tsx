import { useState } from 'react';
import { CATALOG, CATEGORIES, COMPONENT_TYPES, type Category, type ComponentType } from '../../sim/catalog';
import { DRAG_MIME } from './Canvas';
import { SymbolPreview } from './symbols';

interface Props {
  disabled: boolean;
  onDragType(type: ComponentType | null): void;
}

export function LibraryPanel({ disabled, onDragType }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Partial<Record<Category, boolean>>>({});
  const q = query.trim().toLocaleLowerCase('tr');
  const matches = (t: ComponentType) => {
    if (!q) return true;
    const spec = CATALOG[t];
    return (
      spec.title.toLocaleLowerCase('tr').includes(q) ||
      spec.description.toLocaleLowerCase('tr').includes(q) ||
      spec.prefix.toLocaleLowerCase('tr') === q
    );
  };
  const visible = COMPONENT_TYPES.filter(matches);

  return (
    <aside className={`dock library${disabled ? ' disabled' : ''}`}>
      <header className="dock-title">
        Kütüphane <span className="count">{visible.length}</span>
      </header>
      <input
        className="search"
        type="search"
        placeholder="Eleman ara (ad, açıklama, önek)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {disabled && <p className="dock-note">Simülasyon modunda düzenleme kapalıdır. Düzenle moduna dönün.</p>}
      <div className="library-scroll">
        {CATEGORIES.map((cat) => {
          const types = visible.filter((t) => CATALOG[t].category === cat);
          if (types.length === 0) return null;
          const closed = !q && collapsed[cat];
          return (
            <section key={cat}>
              <h3>
                <button
                  type="button"
                  className="cat-toggle"
                  aria-expanded={!closed}
                  onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                >
                  <span className="chevron">{closed ? '▸' : '▾'}</span> {cat}
                  <span className="count">{types.length}</span>
                </button>
              </h3>
              {!closed && (
                <ul>
                  {types.map((t) => (
                    <li
                      key={t}
                      draggable={!disabled}
                      title={disabled ? undefined : `${CATALOG[t].description}\nÇizim alanına sürükleyin`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_MIME, t);
                        e.dataTransfer.effectAllowed = 'copy';
                        onDragType(t);
                      }}
                      onDragEnd={() => onDragType(null)}
                    >
                      <SymbolPreview type={t} />
                      <span>
                        <strong>{CATALOG[t].title}</strong>
                        <small>{CATALOG[t].description}</small>
                        <small className="mono">
                          {CATALOG[t].prefix} · {CATALOG[t].terminals.length} terminal
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {visible.length === 0 && <p className="dock-note">Aramayla eşleşen eleman yok.</p>}
      </div>
    </aside>
  );
}
