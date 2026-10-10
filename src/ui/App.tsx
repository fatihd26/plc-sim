// Uygulama kabuğu (CAD düzeni): şerit araç çubuğu, solda kütüphane, ortada çizim alanı ve sayfa
// sekmeleri, sağda özellikler, altta PLC paneli ve durum çubuğu. Düzenle ve Simülasyon olmak üzere
// iki mod vardır.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { EXAMPLES, type Example } from '../sim/examples';
import type { LadderProgram } from '../sim/ladder';
import { startStopProgram } from '../sim/programs';
import { emptySchematic, pagesOf, pageOf, type Schematic } from '../sim/schematic';
import { buildSymbolTable } from '../sim/symbolTable';
import { Canvas, type DragItem, type ViewInfo } from './editor/Canvas';
import {
  copySelection,
  editorReducer,
  EMPTY_SELECTION,
  initEditor,
  isEmpty,
  nextId,
  selectComponent,
  single,
  type Clipboard,
} from './editor/document';
import { bounds, GRID, snap, unionBounds } from './editor/geometry';
import { pageContent } from './editor/layout';
import { LibraryPanel } from './editor/LibraryPanel';
import { PropertiesPanel } from './editor/PropertiesPanel';
import { IoTable } from './IoTable';
import { LadderEditor } from './LadderEditor';
import { LadderView } from './LadderView';
import { downloadSchematic, FILE_EXTENSION, loadAutosave, parseSchematic, saveAutosave } from './project';
import { useSimulation } from './useSimulation';

type Mode = 'edit' | 'sim';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/** Yapıştırma kaydırması: imleç yoksa her yapıştırmada biraz daha kaydırılır. */
const PASTE_STEP = 2 * GRID;

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initEditor(loadAutosave()));
  const { schematic, selection } = editor;
  const [mode, setMode] = useState<Mode>('edit');
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [placing, setPlacing] = useState<DragItem | null>(null);
  const [view, setView] = useState<ViewInfo>({ cursor: null, zoom: 1 });
  const [fitSignal, setFitSignal] = useState(0);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pageState, setPage] = useState<string>(() => pagesOf(schematic)[0]!.id);
  const [plcChoice, setPlcChoice] = useState<string | null>(null);
  const clipboard = useRef<{ clip: Clipboard; pastes: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pages = pagesOf(schematic);
  const page = pages.some((p) => p.id === pageState) ? pageState : pages[0]!.id;

  const sim = useSimulation(mode === 'sim' ? schematic : null);
  const { snapshot, running } = sim;

  useEffect(() => saveAutosave(schematic), [schematic]);

  const fit = useCallback(() => setFitSignal((n) => n + 1), []);

  // Alt panel açılıp kapanınca çizim alanı boyutu değişir: şemayı yeniden sığdır.
  useEffect(fit, [bottomOpen, mode, fit]);
  const loadNew = useCallback(
    (next: Schematic, note: string) => {
      setMode('edit');
      dispatch({ type: 'load', schematic: next });
      setPage(pagesOf(next)[0]!.id);
      setPlcChoice(null);
      setMessage(note);
      fit();
    },
    [fit],
  );

  const toggleMode = useCallback(() => setMode((m) => (m === 'edit' ? 'sim' : 'edit')), []);

  // --- PLC seçimi: seçili PLC, yoksa son seçilen, yoksa ilk PLC ---------------------------
  const plcs = schematic.components.filter((c) => c.type === 'plc');
  const selectedOne = single(selection);
  const selectedPlc =
    selectedOne?.kind === 'component' && plcs.some((c) => c.id === selectedOne.id) ? selectedOne.id : null;
  useEffect(() => {
    if (selectedPlc) setPlcChoice(selectedPlc);
  }, [selectedPlc]);
  const plc = plcs.find((c) => c.id === plcChoice) ?? plcs[0];
  const plcState = plc && snapshot?.components[plc.id];
  const program: LadderProgram = plc?.program ?? startStopProgram;
  const symbols = useMemo(() => (plc ? buildSymbolTable(schematic, plc.id) : {}), [schematic, plc?.id]);

  // Butonların basılı durumu çekirdekten okunur (tek doğruluk kaynağı).
  const heldButtons = useMemo(() => {
    const held: Record<string, boolean> = {};
    for (const [id, st] of Object.entries(snapshot?.components ?? {})) {
      if (st.type === 'buttonNO' || st.type === 'buttonNC' || st.type === 'estop' || st.type === 'custom') {
        held[id] = st.pressed;
      }
    }
    return held;
  }, [snapshot]);

  const onButton = useCallback(
    (component: string, pressed: boolean) => sim.send({ type: 'button', component, pressed }),
    [sim.send],
  );
  const onToggle = useCallback(
    (component: string) => {
      const st = snapshot?.components[component];
      if (st?.type === 'estop') sim.send({ type: 'button', component, pressed: !st.pressed });
      else if (st?.type === 'breaker3' || st?.type === 'fuse') sim.send({ type: 'switch', component, closed: !st.closed });
      else if (st?.type === 'conveyor') sim.send({ type: 'addBox', component });
    },
    [snapshot, sim.send],
  );

  const jump = useCallback((target: string, component: string) => {
    setPage(target);
    dispatch({ type: 'select', selection: selectComponent(component) });
  }, []);

  // --- Pano ---------------------------------------------------------------------------------
  const copy = useCallback(() => {
    if (!selection.components.length) return false;
    clipboard.current = { clip: copySelection(schematic, selection), pastes: 0 };
    setMessage(`${selection.components.length} eleman kopyalandı`);
    return true;
  }, [schematic, selection]);

  const paste = useCallback(() => {
    const cb = clipboard.current;
    if (!cb) return;
    const b = unionBounds(cb.clip.components.map(bounds));
    if (!b) return;
    cb.pastes++;
    const c = view.cursor;
    const dx = c ? snap(c.x - b.x) : PASTE_STEP * cb.pastes;
    const dy = c ? snap(c.y - b.y) : PASTE_STEP * cb.pastes;
    dispatch({ type: 'paste', clip: cb.clip, dx, dy, page });
  }, [view.cursor, page]);

  // --- Sayfalar -----------------------------------------------------------------------------
  const addPage = () => {
    const id = nextId('p', pages.map((p) => p.id));
    dispatch({ type: 'addPage', id, title: `Sayfa ${pages.length + 1}` });
    setPage(id);
  };
  const deletePage = (id: string) => {
    const p = pages.find((x) => x.id === id);
    const count = schematic.components.filter((c) => pageOf(schematic, c) === id).length;
    if (!p || pages.length <= 1) return;
    if (count && !window.confirm(`"${p.title}" sayfası ve üzerindeki ${count} eleman silinsin mi?`)) return;
    dispatch({ type: 'deletePage', id });
  };
  const gotoPage = useCallback(
    (delta: -1 | 1) => {
      const i = pages.findIndex((p) => p.id === page);
      const next = pages[i + delta];
      if (next) setPage(next.id);
    },
    [pages, page],
  );

  // --- Klavye kısayolları ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'F5') {
        e.preventDefault();
        toggleMode();
      } else if (key === 'f' && !ctrl) {
        fit();
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        gotoPage(e.key === 'PageUp' ? -1 : 1);
      } else if (mode === 'sim' && e.key === ' ') {
        e.preventDefault();
        if (running) sim.pause();
        else sim.start();
      } else if (mode === 'edit') {
        if (ctrl && key === 'z' && !e.shiftKey) {
          e.preventDefault();
          dispatch({ type: 'undo' });
        } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
          e.preventDefault();
          dispatch({ type: 'redo' });
        } else if (ctrl && key === 'c') {
          copy();
        } else if (ctrl && key === 'x') {
          if (copy()) dispatch({ type: 'deleteSelection' });
        } else if (ctrl && key === 'v') {
          e.preventDefault();
          paste();
        } else if (ctrl && key === 'd') {
          e.preventDefault();
          if (selection.components.length) {
            dispatch({ type: 'paste', clip: copySelection(schematic, selection), dx: PASTE_STEP, dy: PASTE_STEP, page });
          }
        } else if (ctrl && key === 'a') {
          e.preventDefault();
          const content = pageContent(schematic, page);
          dispatch({
            type: 'select',
            selection: { components: content.components.map((c) => c.id), wires: content.wires.map((w) => w.id) },
          });
        } else if (key === 'r' && !ctrl && selection.components.length) {
          dispatch({ type: 'rotate', ids: selection.components });
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          dispatch({ type: 'deleteSelection' });
        } else if (e.key === 'Escape') {
          setPlacing(null);
          dispatch({ type: 'select', selection: EMPTY_SELECTION });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, running, selection, schematic, page, fit, toggleMode, gotoPage, copy, paste, sim.pause, sim.start]);

  // --- Dosya ------------------------------------------------------------------------------
  const onOpenFile = async (file: File) => {
    try {
      loadNew(parseSchematic(await file.text()), `${file.name} açıldı`);
    } catch (e) {
      setMessage(`Açılamadı: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const shorts = snapshot?.shorts ?? [];
  const lastEvent = snapshot?.events.at(-1);
  const nameOf = (key: string) => {
    const [id, t] = key.split(':');
    return `${schematic.components.find((c) => c.id === id)?.name ?? id}:${t}`;
  };
  const edit = mode === 'edit';
  const hasSelection = !isEmpty(selection);

  return (
    <div className={`app mode-${mode}`}>
      <header className="titlebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ⏚
          </span>
          PLC-SIM <span className="version">v0.3</span>
        </div>
        <nav className="mode-tabs" role="tablist" aria-label="Çalışma modu">
          <button type="button" role="tab" aria-selected={edit} className={edit ? 'active' : ''} onClick={() => setMode('edit')}>
            ✎ Düzenle
          </button>
          <button type="button" role="tab" aria-selected={!edit} className={!edit ? 'active' : ''} onClick={() => setMode('sim')}>
            ▶ Simülasyon
          </button>
        </nav>
        <div className="clock mono">
          {snapshot ? (
            <>
              t = {(snapshot.timeMs / 1000).toFixed(3)} s
              {plcState?.type === 'plc' && (
                <>
                  {' '}
                  · {plc!.name} scan #{plcState.scanCount} · T<sub>scan</sub> = {plcState.scanTimeMs} ms
                </>
              )}
            </>
          ) : (
            'Simülasyon kapalı'
          )}
        </div>
      </header>

      <div className="ribbon" role="toolbar" aria-label="Komutlar">
        <Group label="Dosya">
          <Tool icon="🗋" label="Yeni" disabled={!edit} onClick={() => loadNew(emptySchematic(), 'Yeni proje')} />
          <ExamplesMenu disabled={!edit} onPick={(e) => loadNew(e.build(), `Örnek yüklendi: ${e.title}`)} />
          <Tool icon="📂" label="Aç" disabled={!edit} onClick={() => fileRef.current?.click()} />
          <Tool icon="💾" label="Kaydet" onClick={() => downloadSchematic(schematic)} />
          <input
            ref={fileRef}
            type="file"
            accept={`${FILE_EXTENSION},.json,application/json`}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onOpenFile(f);
            }}
          />
        </Group>
        <Group label="Düzen">
          <Tool icon="↶" label="Geri al" title="Ctrl+Z" disabled={!edit || !editor.past.length} onClick={() => dispatch({ type: 'undo' })} />
          <Tool icon="↷" label="Yinele" title="Ctrl+Y" disabled={!edit || !editor.future.length} onClick={() => dispatch({ type: 'redo' })} />
          <Tool icon="⧉" label="Kopyala" title="Ctrl+C" disabled={!edit || !selection.components.length} onClick={copy} />
          <Tool icon="📋" label="Yapıştır" title="Ctrl+V" disabled={!edit} onClick={paste} />
          <Tool
            icon="⟳"
            label="Döndür"
            title="R"
            disabled={!edit || !selection.components.length}
            onClick={() => dispatch({ type: 'rotate', ids: selection.components })}
          />
          <Tool icon="✕" label="Sil" title="Del" disabled={!edit || !hasSelection} onClick={() => dispatch({ type: 'deleteSelection' })} />
        </Group>
        <Group label="Görünüm">
          <Tool icon="⤢" label="Sığdır" title="F" onClick={fit} />
          <Tool icon="＋" label="Yeni sayfa" disabled={!edit} onClick={addPage} />
          <Tool icon="▤" label="PLC paneli" active={bottomOpen} onClick={() => setBottomOpen((o) => !o)} />
        </Group>
        <Group label="Simülasyon">
          {running ? (
            <Tool icon="⏸" label="Duraklat" title="Boşluk" onClick={sim.pause} />
          ) : (
            <Tool icon="▶" label="Başlat" title="Boşluk" primary disabled={edit || !snapshot} onClick={sim.start} />
          )}
          <Tool icon="+1" label="1 ms" disabled={edit || running || !snapshot} onClick={sim.stepTick} />
          <Tool icon="⟲" label="1 scan" disabled={edit || running || !snapshot} onClick={sim.stepScan} />
          <Tool icon="↺" label="Sıfırla" disabled={edit || !snapshot} onClick={sim.reset} />
        </Group>
      </div>

      <div className="workspace">
        <LibraryPanel
          disabled={!edit}
          library={schematic.library ?? []}
          dispatch={dispatch}
          onDrag={setDrag}
          placing={edit ? placing : null}
          onPlace={setPlacing}
        />

        <main className="center">
          <Canvas
            schematic={schematic}
            page={page}
            selection={selection}
            dispatch={dispatch}
            mode={mode}
            running={running}
            snapshot={snapshot}
            drag={drag}
            placing={edit ? placing : null}
            onPlaced={() => setPlacing(null)}
            onButton={onButton}
            onToggle={onToggle}
            heldButtons={heldButtons}
            onView={setView}
            onJump={jump}
            fitSignal={fitSignal}
          />
          <PageTabs
            pages={pages}
            current={page}
            editable={edit}
            onSelect={setPage}
            onAdd={addPage}
            onRename={(id, title) => dispatch({ type: 'renamePage', id, title })}
            onDelete={deletePage}
          />
          {sim.error && (
            <div className="banner error">
              <strong>Simülasyon kurulamadı:</strong> {sim.error}
            </div>
          )}
          {bottomOpen && (
            <section className="bottom-dock">
              <header className="dock-title">
                {edit ? 'PLC programı' : 'PLC: online izleme ve I/O'}
                {plcs.length > 0 && (
                  <select
                    className="plc-select"
                    aria-label="İzlenen PLC"
                    value={plc?.id}
                    onChange={(e) => setPlcChoice(e.target.value)}
                  >
                    {plcs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({pages.find((p) => p.id === pageOf(schematic, c))?.title})
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="icon" aria-label="Paneli kapat" onClick={() => setBottomOpen(false)}>
                  ✕
                </button>
              </header>
              {!plc ? (
                <p className="dock-note">Şemada PLC yok. Kütüphaneden bir PLC ekleyin.</p>
              ) : edit ? (
                <LadderEditor
                  key={plc.id}
                  program={program}
                  symbols={symbols}
                  onChange={(p) => dispatch({ type: 'setProgram', id: plc.id, program: p })}
                />
              ) : plcState?.type === 'plc' ? (
                <div className="bottom-body">
                  <div className="ladder-pane">
                    <LadderView networks={program.networks} trace={plcState.trace} symbols={symbols} />
                  </div>
                  <div className="io-pane">
                    <IoTable plc={plcState} symbols={symbols} />
                  </div>
                </div>
              ) : (
                <p className="dock-note">Simülasyon kurulamadı.</p>
              )}
            </section>
          )}
        </main>

        <PropertiesPanel
          schematic={schematic}
          selection={selection}
          dispatch={dispatch}
          mode={mode}
          snapshot={snapshot}
          send={sim.send}
          onButton={onButton}
          heldButtons={heldButtons}
          onJump={jump}
          onEditProgram={(id) => {
            setPlcChoice(id);
            setBottomOpen(true);
          }}
          onCopy={copy}
        />
      </div>

      <footer className="statusbar mono">
        <span className="cell coords">
          {view.cursor ? `X ${Math.round(view.cursor.x)}  Y ${Math.round(view.cursor.y)}` : 'X —  Y —'}
        </span>
        <span className="cell">Zoom {Math.round(view.zoom * 100)}%</span>
        <span className="cell on">IZGARA {GRID}</span>
        <span className="cell on">YAKALA</span>
        <span className="cell on">ORTO</span>
        <span className="cell">
          {schematic.components.filter((c) => c.type !== 'junction').length} eleman · {schematic.wires.length} kablo
          {hasSelection && ` · ${selection.components.length + selection.wires.length} seçili`}
        </span>
        <span className={`cell mode ${mode}`}>{edit ? 'DÜZENLE' : running ? 'SİMÜLASYON ▶' : 'SİMÜLASYON ⏸'}</span>
        {shorts.length > 0 ? (
          <span className="cell fault" title={shorts.map((n) => n.map(nameOf).join(', ')).join('\n')}>
            ⚠ Kısa devre (koruma yok): {shorts.length} net ({shorts[0]!.slice(0, 3).map(nameOf).join(', ')}
            {shorts[0]!.length > 3 ? '…' : ''})
          </span>
        ) : lastEvent ? (
          <span className="cell warn" title="Tüm olaylar: Özellikler › Proje">
            ⚡ {lastEvent.text}
          </span>
        ) : (
          message && (
            <span className="cell message" onClick={() => setMessage(null)}>
              {message}
            </span>
          )
        )}
      </footer>
    </div>
  );
}

function PageTabs(props: {
  pages: { id: string; title: string }[];
  current: string;
  editable: boolean;
  onSelect(id: string): void;
  onAdd(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <nav className="page-tabs" aria-label="Sayfalar">
      {props.pages.map((p, i) => (
        <div key={p.id} className={`page-tab${p.id === props.current ? ' active' : ''}`}>
          {renaming === p.id ? (
            <input
              autoFocus
              defaultValue={p.title}
              onBlur={(e) => {
                props.onRename(p.id, e.target.value);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button
              type="button"
              title={props.editable ? 'Çift tıkla: yeniden adlandır' : undefined}
              onClick={() => props.onSelect(p.id)}
              onDoubleClick={() => props.editable && setRenaming(p.id)}
            >
              <span className="page-no">{i + 1}</span> {p.title}
            </button>
          )}
          {props.editable && props.pages.length > 1 && p.id === props.current && (
            <button type="button" className="icon" title="Sayfayı sil" onClick={() => props.onDelete(p.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {props.editable && (
        <button type="button" className="page-add" title="Yeni sayfa" onClick={props.onAdd}>
          +
        </button>
      )}
    </nav>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-tools">{children}</div>
      <div className="ribbon-label">{label}</div>
    </div>
  );
}

/** Örnek şemalar menüsü. Araç çubuğu kaydırılabildiği için liste sabit konumda açılır. */
function ExamplesMenu({ disabled, onPick }: { disabled: boolean; onPick(e: Example): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at]);
  return (
    <div ref={ref}>
      <Tool
        icon="⚡"
        label="Örnek ▾"
        disabled={disabled}
        active={!!at}
        onClick={() => {
          const r = ref.current!.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom + 4 });
        }}
      />
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} />
          <ul className="menu" role="menu" style={{ left: at.x, top: at.y }}>
            {EXAMPLES.map((e) => (
              <li key={e.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAt(null);
                    onPick(e);
                  }}
                >
                  <strong>{e.title}</strong>
                  <small>{e.description}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

interface ToolProps {
  icon: string;
  label: string;
  title?: string;
  disabled?: boolean;
  primary?: boolean;
  active?: boolean;
  onClick(): void;
}

function Tool({ icon, label, title, disabled, primary, active, onClick }: ToolProps) {
  return (
    <button
      type="button"
      className={`tool${primary ? ' primary' : ''}${active ? ' active' : ''}`}
      title={title ? `${label} (${title})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="tool-icon" aria-hidden>
        {icon}
      </span>
      <span className="tool-label">{label}</span>
    </button>
  );
}
