// Uygulama kabuğu (CAD düzeni): şerit araç çubuğu, solda kütüphane, ortada çizim alanı,
// sağda özellikler, altta durum çubuğu. Düzenle ve Simülasyon olmak üzere iki mod vardır.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { ComponentType } from '../sim/catalog';
import { startStopSchematic } from '../sim/examples';
import { startStopProgram } from '../sim/programs';
import { emptySchematic } from '../sim/schematic';
import { Canvas, type ViewInfo } from './editor/Canvas';
import { editorReducer, initEditor } from './editor/document';
import { GRID } from './editor/geometry';
import { LibraryPanel } from './editor/LibraryPanel';
import { PropertiesPanel } from './editor/PropertiesPanel';
import { IoTable } from './IoTable';
import { LadderView } from './LadderView';
import { downloadSchematic, FILE_EXTENSION, loadAutosave, parseSchematic, saveAutosave } from './project';
import { useSimulation } from './useSimulation';

type Mode = 'edit' | 'sim';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initEditor(loadAutosave()));
  const { schematic, selection } = editor;
  const [mode, setMode] = useState<Mode>('edit');
  const [dragType, setDragType] = useState<ComponentType | null>(null);
  const [view, setView] = useState<ViewInfo>({ cursor: null, zoom: 1 });
  const [fitSignal, setFitSignal] = useState(0);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sim = useSimulation(mode === 'sim' ? schematic : null);
  const { snapshot, running } = sim;

  useEffect(() => saveAutosave(schematic), [schematic]);

  const fit = useCallback(() => setFitSignal((n) => n + 1), []);

  // Alt panel açılıp kapanınca çizim alanı boyutu değişir: şemayı yeniden sığdır.
  const dockVisible = mode === 'sim' && bottomOpen;
  useEffect(fit, [dockVisible, fit]);
  const loadNew = useCallback(
    (next: typeof schematic, note: string) => {
      setMode('edit');
      dispatch({ type: 'load', schematic: next });
      setMessage(note);
      fit();
    },
    [fit],
  );

  const toggleMode = useCallback(() => setMode((m) => (m === 'edit' ? 'sim' : 'edit')), []);

  // Butonların basılı durumu çekirdekten okunur (tek doğruluk kaynağı).
  const heldButtons = useMemo(() => {
    const held: Record<string, boolean> = {};
    for (const [id, st] of Object.entries(snapshot?.components ?? {})) {
      if (st.type === 'buttonNO' || st.type === 'buttonNC' || st.type === 'estop') held[id] = st.pressed;
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
      else if (st?.type === 'breaker3') sim.send({ type: 'switch', component, closed: !st.closed });
    },
    [snapshot, sim.send],
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
        } else if (key === 'r' && !ctrl && selection?.kind === 'component') {
          dispatch({ type: 'rotate', id: selection.id });
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          dispatch({ type: 'deleteSelection' });
        } else if (e.key === 'Escape') {
          dispatch({ type: 'select', selection: null });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, running, selection, fit, toggleMode, sim.pause, sim.start]);

  // --- Dosya ------------------------------------------------------------------------------
  const onOpenFile = async (file: File) => {
    try {
      loadNew(parseSchematic(await file.text()), `${file.name} açıldı`);
    } catch (e) {
      setMessage(`Açılamadı: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const firstPlc = schematic.components.find((c) => c.type === 'plc');
  const plcState = firstPlc && snapshot?.components[firstPlc.id];
  const shorts = snapshot?.shorts ?? [];
  const nameOf = (key: string) => {
    const [id, t] = key.split(':');
    return `${schematic.components.find((c) => c.id === id)?.name ?? id}:${t}`;
  };
  const edit = mode === 'edit';

  return (
    <div className={`app mode-${mode}`}>
      <header className="titlebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ⏚
          </span>
          PLC-SIM <span className="version">v0.2</span>
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
                  · scan #{plcState.scanCount} · T<sub>scan</sub> = {plcState.scanTimeMs} ms
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
          <Tool icon="⚡" label="Örnek" disabled={!edit} onClick={() => loadNew(startStopSchematic(), 'Start-stop örneği yüklendi')} />
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
          <Tool
            icon="⟳"
            label="Döndür"
            title="R"
            disabled={!edit || selection?.kind !== 'component'}
            onClick={() => selection?.kind === 'component' && dispatch({ type: 'rotate', id: selection.id })}
          />
          <Tool icon="✕" label="Sil" title="Del" disabled={!edit || !selection} onClick={() => dispatch({ type: 'deleteSelection' })} />
        </Group>
        <Group label="Görünüm">
          <Tool icon="⤢" label="Sığdır" title="F" onClick={fit} />
          <Tool icon="▤" label="PLC paneli" active={bottomOpen} disabled={edit} onClick={() => setBottomOpen((o) => !o)} />
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
        <LibraryPanel disabled={!edit} onDragType={setDragType} />

        <main className="center">
          <Canvas
            schematic={schematic}
            selection={selection}
            dispatch={dispatch}
            mode={mode}
            running={running}
            snapshot={snapshot}
            dragType={dragType}
            onButton={onButton}
            onToggle={onToggle}
            heldButtons={heldButtons}
            onView={setView}
            fitSignal={fitSignal}
          />
          {sim.error && (
            <div className="banner error">
              <strong>Simülasyon kurulamadı:</strong> {sim.error}
            </div>
          )}
          {!edit && bottomOpen && (
            <section className="bottom-dock">
              <header className="dock-title">
                PLC {firstPlc ? `${firstPlc.name}: program (online izleme) ve I/O` : ''}
                <button type="button" className="icon" aria-label="Paneli kapat" onClick={() => setBottomOpen(false)}>
                  ✕
                </button>
              </header>
              {firstPlc && plcState?.type === 'plc' ? (
                <div className="bottom-body">
                  <div className="ladder-pane">
                    <LadderView networks={startStopProgram.networks} trace={plcState.trace} />
                  </div>
                  <div className="io-pane">
                    <IoTable plc={plcState} plcId={firstPlc.id} schematic={schematic} />
                  </div>
                </div>
              ) : (
                <p className="dock-note">Şemada PLC yok. Kütüphaneden bir PLC ekleyin.</p>
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
          {schematic.components.length} eleman · {schematic.wires.length} kablo
        </span>
        <span className={`cell mode ${mode}`}>{edit ? 'DÜZENLE' : running ? 'SİMÜLASYON ▶' : 'SİMÜLASYON ⏸'}</span>
        {shorts.length > 0 ? (
          <span className="cell fault" title={shorts.map((n) => n.map(nameOf).join(', ')).join('\n')}>
            ⚠ Kısa devre: {shorts.length} net ({shorts[0]!.slice(0, 3).map(nameOf).join(', ')}
            {shorts[0]!.length > 3 ? '…' : ''})
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

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-tools">{children}</div>
      <div className="ribbon-label">{label}</div>
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
