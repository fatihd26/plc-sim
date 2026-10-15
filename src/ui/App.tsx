// Uygulama kabuğu (CAD düzeni): şerit araç çubuğu, solda kütüphane, ortada çizim alanı ve sayfa
// sekmeleri, sağda özellikler, altta PLC paneli ve durum çubuğu. Düzenle ve Simülasyon olmak üzere
// iki mod vardır.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { EXAMPLES as BASE_EXAMPLES, type Example } from '../sim/examples';
import { TASK_EXAMPLES, TASKS, taskSchematic } from '../sim/tasks';
import { locate, type Item, type StepContext } from '../learn/curriculum';
import {
  isDone,
  loadProgress,
  nextItem,
  parseProgress,
  PROGRESS_EXTENSION,
  saveProgress,
  serializeProgress,
  type Progress,
} from '../learn/progress';
import type { LadderProgram } from '../sim/ladder';
import { startStopProgram } from '../sim/programs';
import { emptySchematic, pagesOf, pageOf, type Schematic } from '../sim/schematic';
import { buildSymbolTable } from '../sim/symbolTable';
import { strParam } from '../sim/catalog';
import { controllerIo, isController } from '../sim/ioConfig';
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
import { ModbusStatusTable } from './ModbusPanel';
import { downloadJson, downloadSchematic, FILE_EXTENSION, loadAutosave, parseSchematic, saveAutosave } from './project';
import { LearnCoach } from './LearnCoach';
import { LearnHome } from './LearnHome';
import { useSimulation } from './useSimulation';
import { TaskPanel } from './TaskPanel';
import { TrendPanel } from './TrendPanel';
import { viewOf } from './devices';

type Mode = 'edit' | 'sim';

/** Dar ekranda paneller çizim alanının üstüne açılan alt çekmecelerdir; aynı anda biri açıktır. */
type Sheet = 'library' | 'properties' | 'plc';

/** styles.css'teki dar ekran kırılımıyla aynı olmalı. */
const NARROW_QUERY = '(max-width: 760px)';

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

const EXAMPLES: Example[] = [...BASE_EXAMPLES, ...TASK_EXAMPLES];

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
  const narrow = useMediaQuery(NARROW_QUERY);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pageState, setPage] = useState<string>(() => pagesOf(schematic)[0]!.id);
  const [plcChoice, setPlcChoice] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<'plc' | 'trend' | 'task'>('plc');
  const [trendKeys, setTrendKeys] = useState<string[]>([]);
  const clipboard = useRef<{ clip: Clipboard; pastes: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pages = pagesOf(schematic);
  const page = pages.some((p) => p.id === pageState) ? pageState : pages[0]!.id;

  const sim = useSimulation(mode === 'sim' ? schematic : null);
  const { snapshot, running } = sim;

  useEffect(() => saveAutosave(schematic), [schematic]);

  const fit = useCallback(() => setFitSignal((n) => n + 1), []);

  // Dar ekranda PLC paneli de bir çekmecedir. Masaüstünde ayrı açılıp kapanır.
  const plcOpen = narrow ? sheet === 'plc' : bottomOpen;
  const setPlcOpen = useCallback(
    (open: boolean) => {
      if (narrow) setSheet((s) => (open ? 'plc' : s === 'plc' ? null : s));
      else setBottomOpen(open);
    },
    [narrow],
  );
  const toggleSheet = (s: Sheet) => setSheet((cur) => (cur === s ? null : s));

  // Yerleşik alt panel açılıp kapanınca çizim alanı boyutu değişir: şemayı yeniden sığdır.
  // Çekmeceler çizim alanının üstüne açıldığı için boyutu değiştirmez.
  const dockedBottom = !narrow && bottomOpen;
  useEffect(fit, [dockedBottom, narrow, mode, fit]);
  const loadNew = useCallback(
    (next: Schematic, note: string) => {
      setMode('edit');
      dispatch({ type: 'load', schematic: next });
      setPage(pagesOf(next)[0]!.id);
      setPlcChoice(null);
      setTrendKeys([]);
      setBottomTab(next.task ? 'task' : 'plc');
      setMessage(note);
      fit();
    },
    [fit],
  );

  const toggleMode = useCallback(() => setMode((m) => (m === 'edit' ? 'sim' : 'edit')), []);

  // --- Eğitim -------------------------------------------------------------------------------
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [learnHome, setLearnHome] = useState(false);
  useEffect(() => saveProgress(progress), [progress]);
  const learnAt = progress.current ? locate(progress.current.item) : null;
  const learnItem = learnAt && learnAt.item.kind !== 'soon' ? learnAt.item : null;
  const setCurrent = (current: Progress['current']) => setProgress((p) => ({ ...p, current }));

  /** Ders veya görevi açar: şemasını yükler, eğitim kartını gösterir. */
  const openItem = (item: Item) => {
    if (item.kind === 'soon') return;
    const fresh = item.kind === 'task' ? taskSchematic(TASKS.find((t) => t.id === item.taskId)!) : item.build?.();
    if (fresh) {
      const ownWork = !progress.current && schematic.components.length > 0;
      if (ownWork && !window.confirm('Eğitim için yeni bir şema açılacak ve açık proje kapanacak. Saklamak istiyorsan önce Vazgeç deyip Kaydet ile indir. Devam edilsin mi?')) return;
      loadNew(fresh, `Eğitim: ${item.title}`);
    }
    setCurrent({ item: item.id, step: 0 });
    setLearnHome(false);
  };
  const completeItem = (id: string) =>
    setProgress((p) => (isDone(p, id) ? p : { ...p, done: { ...p.done, [id]: new Date().toISOString() } }));
  const saveLearn = () =>
    downloadJson(serializeProgress(progress, schematic), `ilerleme-${new Date().toISOString().slice(0, 10)}${PROGRESS_EXTENSION}`);
  const loadLearn = async (file: File) => {
    try {
      const r = parseProgress(await file.text());
      if (r.schematic) loadNew(parseSchematic(JSON.stringify(r.schematic)), `${file.name} yüklendi`);
      else setMessage(`${file.name} yüklendi`);
      setProgress(r.progress);
    } catch (e) {
      setMessage(`İlerleme yüklenemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /** Eğitim dışı bir proje açılınca eğitim kartı kapanır (ilerleme saklanır). */
  const loadProject = (next: Schematic, note: string) => {
    setCurrent(undefined);
    loadNew(next, note);
  };

  // --- PLC seçimi: seçili PLC, yoksa son seçilen, yoksa ilk PLC ---------------------------
  const plcs = schematic.components.filter((c) => isController(c.type));
  const selectedOne = single(selection);
  const selectedPlc =
    selectedOne?.kind === 'component' && plcs.some((c) => c.id === selectedOne.id) ? selectedOne.id : null;
  useEffect(() => {
    if (selectedPlc) setPlcChoice(selectedPlc);
  }, [selectedPlc]);
  const plc = plcs.find((c) => c.id === plcChoice) ?? plcs[0];
  const ctrlState = plc && snapshot?.components[plc.id];
  // Ladder çalıştıran kontrolörün izleme verisi (PLC veya ladder firmware'li ESP32).
  const plcState = ctrlState?.type === 'plc' ? ctrlState : ctrlState?.type === 'esp32' ? ctrlState.ladder : null;
  const program: LadderProgram = plc?.program ?? (plc?.type === 'plc' ? startStopProgram : { networks: [] });
  const io = useMemo(() => (plc ? controllerIo(plc) : { inputs: [], outputs: [] }), [plc]);
  const ladderOff = plc?.type === 'esp32' && strParam(plc, 'firmware') !== 'ladder';
  // Ladder editöründe seçili eleman; sol kütüphaneden eklenen komutlar da buna göre yerleşir.
  const [ladderSel, setLadderSel] = useState<string | null>(null);
  useEffect(() => setLadderSel(null), [plc?.id]);
  const symbols = useMemo(() => (plc ? buildSymbolTable(schematic, plc.id) : {}), [schematic, plc?.id]);

  // Butonların basılı durumu çekirdekten okunur (tek doğruluk kaynağı).
  const heldButtons = useMemo(() => {
    const held: Record<string, boolean> = {};
    for (const [id, st] of Object.entries(snapshot?.components ?? {})) {
      if (st.type === 'buttonNO' || st.type === 'buttonNC' || st.type === 'estop' || st.type === 'custom') {
        held[id] = st.pressed;
      } else if ('pressed' in st && typeof st.pressed === 'boolean') {
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
      else if (st) {
        const click = viewOf(st.type)?.click;
        if (click && click !== 'hold') sim.send({ type: 'device', component, action: click.action, value: click.value?.(st) });
      }
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
      if (isTyping(e.target) || learnHome) return;
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
  }, [mode, running, selection, schematic, page, fit, toggleMode, gotoPage, copy, paste, sim.pause, sim.start, learnHome]);

  // --- Dosya ------------------------------------------------------------------------------
  const onOpenFile = async (file: File) => {
    try {
      loadProject(parseSchematic(await file.text()), `${file.name} açıldı`);
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
    <div className={`app mode-${mode}`} data-sheet={narrow && sheet ? sheet : undefined}>
      <header className="titlebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ⏚
          </span>
          PLC-SIM <span className="version">v0.4</span>
        </div>
        <button type="button" className={`learn-btn${learnItem || learnHome ? ' active' : ''}`} onClick={() => setLearnHome(true)}>
          🎓 Öğren
        </button>
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
              {plcState && (
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
          <Tool icon="🗋" label="Yeni" disabled={!edit} onClick={() => loadProject(emptySchematic(), 'Yeni proje')} />
          <ExamplesMenu disabled={!edit} onPick={(e) => loadProject(e.build(), `Örnek yüklendi: ${e.title}`)} />
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
          <Tool icon="▤" label="PLC paneli" active={plcOpen} onClick={() => setPlcOpen(!plcOpen)} />
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
          onOpenPlc={() => {
            setMode('edit');
            setPlcOpen(true);
          }}
          onDrag={setDrag}
          placing={edit ? placing : null}
          onPlace={(item) => {
            setPlacing(item);
            // Dar ekranda seçilen eleman çizim alanına tıklanarak yerleştirilir: çekmece kapanır.
            if (item && narrow) setSheet(null);
          }}
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
          {learnItem && progress.current && (
            <LearnCoach
              key={learnItem.id}
              item={learnItem}
              step={progress.current.step}
              ctx={{ schematic, snapshot, mode, running, plcOpen } satisfies StepContext}
              done={isDone(progress, learnItem.id)}
              attempts={progress.attempts[learnItem.id] ?? 0}
              next={nextItem({ ...progress, done: { ...progress.done, [learnItem.id]: 'x' } }, learnItem.id)}
              onStep={(step) => setCurrent({ item: learnItem.id, step })}
              onComplete={() => completeItem(learnItem.id)}
              onAttempt={() =>
                setProgress((p) => ({ ...p, attempts: { ...p.attempts, [learnItem.id]: (p.attempts[learnItem.id] ?? 0) + 1 } }))
              }
              onNext={() => {
                const n = nextItem({ ...progress, done: { ...progress.done, [learnItem.id]: 'x' } }, learnItem.id);
                if (n) openItem(n);
              }}
              onHome={() => setLearnHome(true)}
              onClose={() => setCurrent(undefined)}
              onShowPanel={(tab) => {
                setPlcOpen(true);
                setBottomTab(tab);
              }}
            />
          )}
          {sim.error && (
            <div className="banner error">
              <strong>Simülasyon kurulamadı:</strong> {sim.error}
            </div>
          )}
          {plcOpen && (
            <section className="bottom-dock">
              <header className="dock-title">
                <nav className="dock-tabs" aria-label="Alt panel">
                  <button type="button" className={bottomTab === 'plc' ? 'active' : ''} onClick={() => setBottomTab('plc')}>
                    {edit ? 'Program' : 'Online izleme'}
                  </button>
                  <button type="button" className={bottomTab === 'trend' ? 'active' : ''} onClick={() => setBottomTab('trend')}>
                    Trend
                  </button>
                  <button type="button" className={bottomTab === 'task' ? 'active' : ''} onClick={() => setBottomTab('task')}>
                    Görev{schematic.task ? ' •' : ''}
                  </button>
                </nav>
                {bottomTab === 'plc' && plcs.length > 0 && (
                  <select
                    className="plc-select"
                    aria-label="İzlenen kontrolör"
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
                <button type="button" className="icon" aria-label="Paneli kapat" onClick={() => setPlcOpen(false)}>
                  ✕
                </button>
              </header>
              {bottomTab === 'trend' ? (
                <TrendPanel schematic={schematic} snapshot={snapshot} selected={trendKeys} onSelected={setTrendKeys} />
              ) : bottomTab === 'task' ? (
                <TaskPanel
                  schematic={schematic}
                  edit={edit}
                  dispatch={dispatch}
                  onResult={(ok) => learnItem?.kind === 'task' && ok && completeItem(learnItem.id)}
                />
              ) : !plc ? (
                <p className="dock-note">Şemada PLC veya ESP32 yok. Kütüphaneden bir PLC ya da ESP32 I/O kartı ekleyin.</p>
              ) : edit ? (
                <>
                {ladderOff && (
                  <p className="dock-note warn">
                    {plc.name} firmware'i "Ladder programı" değil; bu program çalışmaz. ESP32'nin Firmware ayarını
                    "Ladder programı" yapın.
                  </p>
                )}
                <LadderEditor
                  key={plc.id}
                  program={program}
                  symbols={symbols}
                  onChange={(p) => dispatch({ type: 'setProgram', id: plc.id, program: p })}
                  selected={ladderSel}
                  onSelect={setLadderSel}
                  controller={plc}
                  onParams={(params) => dispatch({ type: 'setParams', id: plc.id, params })}
                  onPolls={(polls) => dispatch({ type: 'setPolls', id: plc.id, polls })}
                />
                </>
              ) : plcState ? (
                <div className="bottom-body">
                  <div className="ladder-pane">
                    <LadderView networks={program.networks} trace={plcState.trace} symbols={symbols} />
                  </div>
                  <div className="io-pane">
                    <IoTable plc={plcState} io={io} symbols={symbols} program={program} />
                    {ctrlState?.type === 'plc' && plc.modbusPolls?.length ? (
                      <ModbusStatusTable polls={plc.modbusPolls} status={ctrlState.modbus} />
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="dock-note">
                  {ladderOff ? `${plc.name} ladder programı çalıştırmıyor (firmware ayarı).` : 'Simülasyon kurulamadı.'}
                </p>
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
            setPlcOpen(true);
          }}
          onCopy={copy}
        />
      </div>

      <footer className="statusbar mono">
        <span className="cell coords opt">
          {view.cursor ? `X ${Math.round(view.cursor.x)}  Y ${Math.round(view.cursor.y)}` : 'X —  Y —'}
        </span>
        <span className="cell opt">Zoom {Math.round(view.zoom * 100)}%</span>
        <span className="cell on opt">IZGARA {GRID}</span>
        <span className="cell on opt">YAKALA</span>
        <span className="cell on opt">ORTO</span>
        <span className="cell opt">
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

      {learnHome && (
        <LearnHome
          progress={progress}
          onOpen={openItem}
          onClose={() => setLearnHome(false)}
          onSave={saveLearn}
          onLoad={(f) => void loadLearn(f)}
        />
      )}

      {narrow && (
        <nav className="sheet-tabs" aria-label="Paneller">
          <SheetTab icon="▦" label="Kütüphane" active={sheet === 'library'} onClick={() => toggleSheet('library')} />
          <SheetTab
            icon="☰"
            label="Özellikler"
            badge={hasSelection ? selection.components.length + selection.wires.length : undefined}
            active={sheet === 'properties'}
            onClick={() => toggleSheet('properties')}
          />
          <SheetTab icon="▤" label="PLC" active={sheet === 'plc'} onClick={() => toggleSheet('plc')} />
        </nav>
      )}
    </div>
  );
}

function SheetTab(props: { icon: string; label: string; badge?: number; active: boolean; onClick(): void }) {
  return (
    <button type="button" className={props.active ? 'active' : ''} aria-pressed={props.active} onClick={props.onClick}>
      <span className="tool-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="tool-label">
        {props.label}
        {props.badge ? <span className="count">{props.badge}</span> : null}
      </span>
    </button>
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
          // Menü genişliği min(360px, 100vw - 32px): dar ekranda sağdan taşmasın
          const w = Math.min(360, window.innerWidth - 32);
          setAt(at ? null : { x: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)), y: r.bottom + 4 });
        }}
      />
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} />
          <ul className="menu" role="menu" style={{ left: at.x, top: at.y }}>
            {EXAMPLES.map((e, i) => (
              <li key={e.id} role="none">
                {(i === 0 || EXAMPLES[i - 1]!.group !== e.group) && <div className="menu-group">{e.group}</div>}
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
