// CAD tarzı çizim alanı: ızgara, imleç merkezli zoom, kaydırma, yakalama (snap),
// kütüphaneden sürükle-bırak, terminalden terminale kablo çizimi ve simülasyonda etkileşim.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import type { ComponentType } from '../../sim/catalog';
import type { NetPotential } from '../../sim/netlist';
import { terminalKey, type ComponentInstance, type Schematic, type TerminalRef } from '../../sim/schematic';
import type { SimSnapshot } from '../../sim/simulation';
import type { EditorAction, Selection } from './document';
import { bounds, GEOMETRY, snap, unionBounds, worldTerminal, worldTerminals, type Point, type WorldTerminal } from './geometry';
import { route, toPath } from './routing';
import { SymbolBody } from './symbols';

export const DRAG_MIME = 'application/x-plcsim-component';

export interface ViewInfo {
  cursor: Point | null;
  zoom: number;
}

interface Props {
  schematic: Schematic;
  selection: Selection;
  dispatch(action: EditorAction): void;
  mode: 'edit' | 'sim';
  running: boolean;
  snapshot: SimSnapshot | null;
  /** Kütüphaneden sürüklenmekte olan tip (dragover sırasında veri okunamadığı için). */
  dragType: ComponentType | null;
  onButton(component: string, pressed: boolean): void;
  /** Kilitlemeli elemanlar (acil stop, şalter): her tıklama durumu değiştirir. */
  onToggle(component: string): void;
  heldButtons: Record<string, boolean>;
  onView(info: ViewInfo): void;
  fitSignal: number;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { kind: 'move'; id: string; start: Point; dx: number; dy: number }
  | { kind: 'wire'; from: WorldTerminal; sticky: boolean; startX: number; startY: number }
  | { kind: 'press'; id: string };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
const SNAP_RADIUS = 9;

const potentialClass = (p: NetPotential | undefined) => (p ? `p-${p}` : '');

const MOMENTARY = new Set<ComponentType>(['buttonNO', 'buttonNC']);
const LATCHING = new Set<ComponentType>(['estop', 'breaker3']);
const isInteractive = (t: ComponentType) => MOMENTARY.has(t) || LATCHING.has(t);

export function Canvas(props: Props) {
  const { schematic, selection, dispatch, mode, snapshot, running } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState({ x: -20, y: -20, zoom: 1 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: 'none' });
  const [ghost, setGhost] = useState<Point | null>(null);

  const byId = useMemo(() => new Map(schematic.components.map((c) => [c.id, c])), [schematic.components]);

  // Taşınan bileşen önizlemesi için konum düzeltmesi
  const placed = useCallback(
    (c: ComponentInstance): ComponentInstance =>
      gesture.kind === 'move' && gesture.id === c.id ? { ...c, x: c.x + gesture.dx, y: c.y + gesture.dy } : c,
    [gesture],
  );

  const allTerminals = useMemo(
    () => schematic.components.flatMap((c) => worldTerminals(placed(c))),
    [schematic.components, placed],
  );

  // --- Görünüm boyutu ve kamera ---------------------------------------------------------

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: cam.x + (clientX - r.left) / cam.zoom, y: cam.y + (clientY - r.top) / cam.zoom };
    },
    [cam],
  );

  // Tümünü sığdır (Zoom Extents). Boyut doğrudan ölçülür: aynı commit'te değişen yerleşim
  // (ör. alt panelin açılması) ResizeObserver'dan önce hesaba katılır.
  useEffect(() => {
    const host = hostRef.current;
    const b = unionBounds(schematic.components.map(bounds));
    if (!host || !b) return;
    const { width: w, height: h } = host.getBoundingClientRect();
    if (w < 10 || h < 10) return;
    const margin = 60;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(w / (b.w + margin * 2), h / (b.h + margin * 2))));
    setSize({ w, h });
    setCam({ zoom, x: b.x + b.w / 2 - w / zoom / 2, y: b.y + b.h / 2 - h / zoom / 2 });
    // Yalnız istek geldiğinde çalışır (kamera veya şema değişince değil)
  }, [props.fitSignal]);

  // İmleç merkezli zoom (pasif olmayan dinleyici gerekli)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCam((c) => {
        const r = svg.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * Math.exp(-e.deltaY * 0.0015)));
        const wx = c.x + sx / c.zoom;
        const wy = c.y + sy / c.zoom;
        return { zoom, x: wx - sx / zoom, y: wy - sy / zoom };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const { onView } = props;
  useEffect(() => onView({ cursor, zoom: cam.zoom }), [cursor, cam.zoom, onView]);

  // Esc: kablo çizimini iptal et
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGesture({ kind: 'none' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mod değişince yarım kalan işlemi bırak
  useEffect(() => setGesture({ kind: 'none' }), [mode]);

  const nearestTerminal = useCallback(
    (p: Point, exclude?: TerminalRef): WorldTerminal | null => {
      let best: WorldTerminal | null = null;
      let bestD = SNAP_RADIUS;
      for (const t of allTerminals) {
        if (exclude && t.ref.component === exclude.component && t.ref.terminal === exclude.terminal) continue;
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d <= bestD) {
          best = t;
          bestD = d;
        }
      }
      return best;
    },
    [allTerminals],
  );

  // --- İşaretçi olayları ----------------------------------------------------------------

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;
    const compEl = target.closest('[data-comp]');
    const wireEl = target.closest('[data-wire]');

    const startPan = () => {
      setGesture({ kind: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y });
      e.currentTarget.setPointerCapture(e.pointerId);
    };

    if (e.button === 1) {
      e.preventDefault();
      startPan();
      return;
    }
    if (e.button !== 0) return;

    if (mode === 'sim') {
      const id = compEl?.getAttribute('data-comp');
      const c = id ? byId.get(id) : undefined;
      if (c) {
        dispatch({ type: 'select', selection: { kind: 'component', id: c.id } });
        if (LATCHING.has(c.type)) {
          props.onToggle(c.id);
        } else if (MOMENTARY.has(c.type)) {
          if (running) {
            props.onButton(c.id, true);
            setGesture({ kind: 'press', id: c.id });
            e.currentTarget.setPointerCapture(e.pointerId);
          } else {
            props.onButton(c.id, !props.heldButtons[c.id]);
          }
        }
        return;
      }
      startPan();
      return;
    }

    // Düzenleme modu
    const term = nearestTerminal(p);
    if (gesture.kind === 'wire' && gesture.sticky) {
      if (term) dispatch({ type: 'connect', a: gesture.from.ref, b: term.ref });
      setGesture({ kind: 'none' });
      return;
    }
    if (term) {
      setGesture({ kind: 'wire', from: term, sticky: false, startX: e.clientX, startY: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const compId = compEl?.getAttribute('data-comp');
    if (compId) {
      dispatch({ type: 'select', selection: { kind: 'component', id: compId } });
      setGesture({ kind: 'move', id: compId, start: p, dx: 0, dy: 0 });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const wireId = wireEl?.getAttribute('data-wire');
    if (wireId) {
      dispatch({ type: 'select', selection: { kind: 'wire', id: wireId } });
      return;
    }
    dispatch({ type: 'select', selection: null });
    startPan();
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    if (gesture.kind === 'pan') {
      setCam((c) => ({
        ...c,
        x: gesture.camX - (e.clientX - gesture.startX) / c.zoom,
        y: gesture.camY - (e.clientY - gesture.startY) / c.zoom,
      }));
    } else if (gesture.kind === 'move') {
      const dx = snap(p.x - gesture.start.x);
      const dy = snap(p.y - gesture.start.y);
      if (dx !== gesture.dx || dy !== gesture.dy) setGesture({ ...gesture, dx, dy });
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    switch (gesture.kind) {
      case 'move':
        if (gesture.dx || gesture.dy) {
          const c = byId.get(gesture.id);
          if (c) dispatch({ type: 'move', id: c.id, x: c.x + gesture.dx, y: c.y + gesture.dy });
        }
        setGesture({ kind: 'none' });
        break;
      case 'wire': {
        if (gesture.sticky) break;
        const term = nearestTerminal(p, gesture.from.ref);
        const clicked = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < 4;
        if (term) {
          dispatch({ type: 'connect', a: gesture.from.ref, b: term.ref });
          setGesture({ kind: 'none' });
        } else if (clicked) {
          // Tıkla-tıkla modu: ikinci tıklama hedef terminali seçer
          setGesture({ ...gesture, sticky: true });
        } else {
          setGesture({ kind: 'none' });
        }
        break;
      }
      case 'press':
        props.onButton(gesture.id, false);
        setGesture({ kind: 'none' });
        break;
      case 'pan':
        setGesture({ kind: 'none' });
        break;
    }
  };

  // --- Kütüphaneden bırakma ---------------------------------------------------------------

  const dropPosition = (e: DragEvent, type: ComponentType): Point => {
    const p = toWorld(e.clientX, e.clientY);
    const g = GEOMETRY[type];
    return { x: snap(p.x - g.w / 2), y: snap(p.y - g.h / 2) };
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (mode !== 'edit' || !props.dragType) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setGhost(dropPosition(e, props.dragType));
    setCursor(toWorld(e.clientX, e.clientY));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const type = e.dataTransfer.getData(DRAG_MIME) as ComponentType;
    setGhost(null);
    if (mode !== 'edit' || !(type in GEOMETRY)) return;
    e.preventDefault();
    const pos = dropPosition(e, type);
    dispatch({ type: 'add', componentType: type, x: pos.x, y: pos.y });
  };

  // --- Çizim ------------------------------------------------------------------------------

  const vw = size.w / cam.zoom;
  const vh = size.h / cam.zoom;
  const potentials = snapshot?.potentials;
  const hoverTerm = mode === 'edit' && cursor && gesture.kind !== 'pan' && gesture.kind !== 'move' ? nearestTerminal(cursor) : null;

  const wirePaths = schematic.wires.map((w) => {
    const ca = byId.get(w.a.component);
    const cb = byId.get(w.b.component);
    const ta = ca && worldTerminal(placed(ca), w.a.terminal);
    const tb = cb && worldTerminal(placed(cb), w.b.terminal);
    if (!ta || !tb) return null;
    const pts = route(ta, tb);
    const selected = selection?.kind === 'wire' && selection.id === w.id;
    const pot = potentials?.[terminalKey(w.a)];
    return (
      <g key={w.id} data-wire={w.id} className={`wire ${potentialClass(pot)}${selected ? ' selected' : ''}`}>
        <path d={toPath(pts)} className="wire-hit" />
        <path d={toPath(pts)} className="wire-line" />
        {selected &&
          [ta, tb].map((t, i) => <rect key={i} x={t.x - 3} y={t.y - 3} width={6} height={6} className="grip" />)}
      </g>
    );
  });

  let rubber: Point[] | null = null;
  if (gesture.kind === 'wire' && cursor) {
    const target = nearestTerminal(cursor, gesture.from.ref);
    rubber = route(gesture.from, target ?? { x: snap(cursor.x), y: snap(cursor.y) });
  }

  return (
    <div
      ref={hostRef}
      className={`canvas-host mode-${mode}`}
      onDragOver={onDragOver}
      onDragLeave={() => setGhost(null)}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className={`canvas${gesture.kind === 'pan' ? ' panning' : ''}`}
        viewBox={`${cam.x} ${cam.y} ${vw} ${vh}`}
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid-minor" width={10} height={10} patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" className="grid-minor" />
          </pattern>
          <pattern id="grid-major" width={50} height={50} patternUnits="userSpaceOnUse">
            {cam.zoom >= 0.6 && <rect width={50} height={50} fill="url(#grid-minor)" />}
            <path d="M 50 0 L 0 0 0 50" className="grid-major" />
          </pattern>
        </defs>
        <rect x={cam.x} y={cam.y} width={vw} height={vh} fill="url(#grid-major)" />
        <path d={`M ${cam.x} 0 H ${cam.x + vw} M 0 ${cam.y} V ${cam.y + vh}`} className="axis" />

        <g className="wires">{wirePaths}</g>

        {schematic.components.map((c0) => {
          const c = placed(c0);
          const g = GEOMETRY[c.type];
          const b = bounds(c);
          const selected = selection?.kind === 'component' && selection.id === c.id;
          const interactive = mode === 'sim' && isInteractive(c.type);
          return (
            <g key={c.id} className={`component${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`}>
              {selected && <rect x={b.x - 6} y={b.y - 6} width={b.w + 12} height={b.h + 12} className="selection-box" />}
              <g data-comp={c.id} transform={`translate(${c.x} ${c.y}) rotate(${c.rotation} ${g.w / 2} ${g.h / 2})`}>
                <rect width={g.w} height={g.h} className="body-hit" />
                <g className="symbol">
                  <SymbolBody type={c.type} state={snapshot?.components[c.id]} />
                </g>
                {g.terminals.map((t) => (
                  <text key={t.name} x={t.x + 3} y={t.dir === 'up' ? 9 : t.y - 3} className="term-label">
                    {t.name}
                  </text>
                ))}
              </g>
              <text x={b.x} y={b.y - 5} className="tag">
                {c.name}
              </text>
              {worldTerminals(c).map((t) => (
                <circle
                  key={t.name}
                  cx={t.x}
                  cy={t.y}
                  r={2.5}
                  className={`terminal ${potentialClass(potentials?.[terminalKey(t.ref)])}`}
                >
                  <title>{`${c.name}:${t.name}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {rubber && <path d={toPath(rubber)} className="rubber" />}

        {ghost && props.dragType && (
          <g transform={`translate(${ghost.x} ${ghost.y})`} className="ghost">
            <SymbolBody type={props.dragType} />
          </g>
        )}

        {hoverTerm && (
          <rect x={hoverTerm.x - 5} y={hoverTerm.y - 5} width={10} height={10} className="osnap">
            <title>{hoverTerm.name}</title>
          </rect>
        )}

        {mode === 'edit' && cursor && gesture.kind !== 'pan' && (
          <path
            d={`M ${cam.x} ${cursor.y} H ${cam.x + vw} M ${cursor.x} ${cam.y} V ${cam.y + vh}`}
            className="crosshair"
          />
        )}
      </svg>
      {mode === 'edit' && gesture.kind === 'wire' && (
        <div className="canvas-prompt">
          Kablo: <strong>{byId.get(gesture.from.ref.component)?.name}:{gesture.from.name}</strong> → hedef terminali seçin
          (Esc iptal)
        </div>
      )}
      {mode === 'edit' && schematic.components.length === 0 && (
        <div className="canvas-empty">Kütüphaneden bir elemanı sürükleyip buraya bırakın</div>
      )}
    </div>
  );
}
