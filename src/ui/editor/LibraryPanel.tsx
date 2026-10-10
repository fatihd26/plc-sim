import { useState } from 'react';
import {
  CATALOG,
  CATEGORIES,
  COMPONENT_TYPES,
  MAX_CUSTOM_POLES,
  POLE_KINDS,
  validateCustomDef,
  VOLTAGE_OPTIONS,
  type Category,
  type CustomDef,
  type CustomPole,
  type PoleKind,
  type Voltage,
} from '../../sim/catalog';
import { DRAG_MIME, encodeDrag, type DragItem } from './Canvas';
import type { EditorAction } from './document';
import { SymbolPreview } from './symbols';

interface Props {
  disabled: boolean;
  library: CustomDef[];
  dispatch(action: EditorAction): void;
  onDrag(item: DragItem | null): void;
  /** Tıklanan öğe: çizim alanına bir tıklamayla yerleştirilir (dokunmatik için). */
  placing: DragItem | null;
  onPlace(item: DragItem | null): void;
}

interface Entry {
  key: string;
  item: DragItem;
  title: string;
  description: string;
  prefix: string;
  terminals: number;
  category: Category;
  def?: CustomDef;
}

function entries(library: CustomDef[]): Entry[] {
  const builtin = COMPONENT_TYPES.filter((t) => !CATALOG[t].hidden).map((t) => ({
    key: t,
    item: { type: t },
    title: CATALOG[t].title,
    description: CATALOG[t].description,
    prefix: CATALOG[t].prefix,
    terminals: CATALOG[t].terminals.length,
    category: CATALOG[t].category,
  }));
  const custom = library.map((def) => ({
    key: `custom:${def.id}`,
    item: { type: 'custom' as const, custom: def },
    title: def.title,
    description: def.poles.map((p) => `${p.top}-${p.bottom} ${POLE_KINDS.find((k) => k.value === p.kind)?.label ?? p.kind}`).join(', '),
    prefix: def.prefix,
    terminals: def.poles.length * 2,
    category: 'Kullanıcı' as const,
    def,
  }));
  return [...builtin, ...custom];
}

export function LibraryPanel({ disabled, library, dispatch, onDrag, placing, onPlace }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Partial<Record<Category, boolean>>>({});
  const [editing, setEditing] = useState<CustomDef | null>(null);
  const q = query.trim().toLocaleLowerCase('tr');
  const all = entries(library);
  const visible = all.filter(
    (e) =>
      !q ||
      e.title.toLocaleLowerCase('tr').includes(q) ||
      e.description.toLocaleLowerCase('tr').includes(q) ||
      e.prefix.toLocaleLowerCase('tr') === q,
  );

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
          const items = visible.filter((e) => e.category === cat);
          const isUser = cat === 'Kullanıcı';
          if (items.length === 0 && !(isUser && !q)) return null;
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
                  <span className="count">{items.length}</span>
                </button>
              </h3>
              {!closed && (
                <ul>
                  {items.map((e) => (
                    <li
                      key={e.key}
                      draggable={!disabled}
                      className={placing && encodeDrag(placing) === encodeDrag(e.item) ? 'armed' : undefined}
                      title={disabled ? undefined : `${e.description}\nÇizim alanına sürükleyin veya tıklayıp alana tıklayın`}
                      onClick={(ev) => {
                        if (disabled || (ev.target as Element).closest('button')) return;
                        onPlace(placing && encodeDrag(placing) === encodeDrag(e.item) ? null : e.item);
                      }}
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData(DRAG_MIME, encodeDrag(e.item));
                        ev.dataTransfer.effectAllowed = 'copy';
                        onDrag(e.item);
                      }}
                      onDragEnd={() => onDrag(null)}
                    >
                      <SymbolPreview inst={e.item} />
                      <span>
                        <strong>{e.title}</strong>
                        <small>{e.description}</small>
                        <small className="mono">
                          {e.prefix} · {e.terminals} terminal
                        </small>
                      </span>
                      {e.def && !disabled && (
                        <span className="item-actions">
                          <button type="button" className="icon" title="Düzenle" onClick={() => setEditing(e.def!)}>
                            ✎
                          </button>
                          <button
                            type="button"
                            className="icon"
                            title="Kütüphaneden sil (şemadaki örnekler kalır)"
                            onClick={() => dispatch({ type: 'deleteCustom', id: e.def!.id })}
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                  {isUser && !disabled && (
                    <li className="add-custom" draggable={false}>
                      <button type="button" onClick={() => setEditing(newDef(library))}>
                        + Yeni bileşen tanımla
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          );
        })}
        {visible.length === 0 && q && <p className="dock-note">Aramayla eşleşen eleman yok.</p>}
      </div>
      {editing && (
        <CustomEditor
          initial={editing}
          isNew={!library.some((d) => d.id === editing.id)}
          onCancel={() => setEditing(null)}
          onSave={(def) => {
            dispatch({ type: 'defineCustom', def });
            setEditing(null);
          }}
        />
      )}
    </aside>
  );
}

function newDef(library: CustomDef[]): CustomDef {
  let i = library.length + 1;
  while (library.some((d) => d.id === `u${i}`)) i++;
  return {
    id: `u${i}`,
    title: 'Yardımcı röle',
    prefix: 'KA',
    voltage: '24DC',
    poles: [
      { kind: 'coil', top: 'A1', bottom: 'A2' },
      { kind: 'NO', top: '13', bottom: '14' },
      { kind: 'NC', top: '21', bottom: '22' },
    ],
  };
}

/** Kullanıcı bileşeni tanımlama penceresi: ad, önek, gerilim ve kutup listesi. */
function CustomEditor({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: CustomDef;
  isNew: boolean;
  onSave(def: CustomDef): void;
  onCancel(): void;
}) {
  const [def, setDef] = useState<CustomDef>(() => structuredClone(initial));
  const errors = validateCustomDef(def);
  const setPole = (i: number, patch: Partial<CustomPole>) =>
    setDef((d) => ({ ...d, poles: d.poles.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label="Bileşen tanımı" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Yeni bileşen' : `Bileşeni düzenle: ${initial.title}`}</h3>
        <div className="custom-editor">
          <div className="custom-form">
            <label>
              Ad
              <input value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} />
            </label>
            <label>
              Etiket öneki
              <input
                value={def.prefix}
                maxLength={3}
                onChange={(e) => setDef({ ...def, prefix: e.target.value.toLocaleUpperCase('en') })}
              />
            </label>
            <label>
              Bobin / lamba gerilimi
              <select value={def.voltage} onChange={(e) => setDef({ ...def, voltage: e.target.value as Voltage })}>
                {VOLTAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <table className="poles">
              <thead>
                <tr>
                  <th>Kutup türü</th>
                  <th>Üst</th>
                  <th>Alt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {def.poles.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <select value={p.kind} onChange={(e) => setPole(i, { kind: e.target.value as PoleKind })}>
                        {POLE_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="mono" value={p.top} onChange={(e) => setPole(i, { top: e.target.value })} />
                    </td>
                    <td>
                      <input className="mono" value={p.bottom} onChange={(e) => setPole(i, { bottom: e.target.value })} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon"
                        title="Kutbu sil"
                        onClick={() => setDef({ ...def, poles: def.poles.filter((_, j) => j !== i) })}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              disabled={def.poles.length >= MAX_CUSTOM_POLES}
              onClick={() => {
                const n = def.poles.length + 1;
                setDef({ ...def, poles: [...def.poles, { kind: 'NO', top: `${n}3`, bottom: `${n}4` }] });
              }}
            >
              + Kutup ekle
            </button>
          </div>
          <div className="custom-preview">
            <SymbolPreview inst={{ type: 'custom', custom: def }} width={180} height={120} />
            <p className="muted small">
              Bobin kutbu anma geriliminde çekince NO kontaklar kapanır, NC kontaklar açılır. Buton kutupları
              simülasyonda tıklanınca basılır.
            </p>
          </div>
        </div>
        {errors.length > 0 && (
          <ul className="errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="btn-row end">
          <button type="button" onClick={onCancel}>
            Vazgeç
          </button>
          <button type="button" className="primary" disabled={errors.length > 0} onClick={() => onSave(def)}>
            {isNew ? 'Kütüphaneye ekle' : 'Kaydet (şemadaki örnekler güncellenir)'}
          </button>
        </div>
      </div>
    </div>
  );
}
