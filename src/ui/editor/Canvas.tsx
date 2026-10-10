// CAD tarzı çizim alanı: ızgara, imleç merkezli zoom, kaydırma, yakalama (snap), sayfa çerçevesi,
// kütüphaneden sürükle-bırak, kutu ile çoklu seçim, grup taşıma, terminalden terminale veya kablonun
// ortasına kablo çizimi (Simulink tarzı: boşluğa her tıklama bir köşe noktası bırakır), kablo parçası sürükleme ve simülasyonda etkileşim. Dokunmatikte tek parmak
// kaydırır, iki parmak yakınlaştırır.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { ComponentType, CustomDef } from '../../sim/catalog';
import type { NetPotential } from '../../sim/netlist';
import { pagesOf, terminalKey, type ComponentInstance, type Schematic, type TerminalRef } from '../../sim/schematic';
import type { SimSnapshot } from '../../sim/simulation';
import { selectComponent, selectWire, single, type EditorAction, type Selection } from './document';
import {
  bounds,
  geometryOf,
  snap,
  unionBounds,
  worldTerminal,
  worldTerminals,
  type Point,
  type WorldTerminal,
} from './geometry';
import { boxSelect, pageContent, routePage, SHEET, xrefTargets, type BoxSelect } from './layout';
import { dragSegment, manualRoute, nearestOnPath, orthoJoin, route, stubPoint, toPath, type Endpoint } from './routing';
import { SymbolBody } from './symbols';

export const DRAG_MIME = 'application/x-plcsim-component';

/** Kütüphaneden sürüklenen öğe: yerleşik tip veya kullanıcı tanımı. */
export interface DragItem {
  type: ComponentType;
  custom?: CustomDef;
}

export const encodeDrag = (d: DragItem) => (d.custom ? `custom:${d.custom.id}` : d.type);

export interface ViewInfo {
  cursor: Point | null;
  zoom: number;
}

interface Props {
  schematic: Schematic;
  page: string;
  selection: Selection;
  dispatch(action: EditorAction): void;
  mode: 'edit' | 'sim';
  running: boolean;
  snapshot: SimSnapshot | null;
  /** Kütüphaneden sürüklenmekte olan öğe (dragover sırasında veri okunamadığı için). */
  drag: DragItem | null;
  /** Kütüphanede tıklanıp yerleştirilmeyi bekleyen öğe (dokunmatikte sürükle-bırak yerine). */
  placing: DragItem | null;
  onPlaced(): void;
  onButton(component: string, pressed: boolean): void;
  /** Kilitlemeli elemanlar (acil stop, şalter, sigorta): her tıklama durumu değiştirir. */
  onToggle(component: string): void;
  heldButtons: Record<string, boolean>;
  onView(info: ViewInfo): void;
  /** Sayfa geçişine çift tıklama: karşı sayfaya git. */
  onJump(page: string, component: string): void;
  fitSignal: number;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { kind: 'pinch'; dist: number; mid: Point; cam: { x: number; y: number; zoom: number } }
  | { kind: 'move'; ids: string[]; start: Point; dx: number; dy: number }
  | { kind: 'box'; box: BoxSelect; additive: boolean }
  /** points: boşluğa tıklanarak bırakılan ara noktalar; kablo son noktadan devam eder. */
  | { kind: 'wire'; from: WorldTerminal; points: Point[]; sticky: boolean; startX: number; startY: number }
  | { kind: 'segment'; wire: string; full: Point[]; segment: number; a: Endpoint; b: Endpoint; points: Point[] | null }
  | { kind: 'press'; id: string };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
const SNAP_RADIUS = 9;
const TOUCH_SNAP_RADIUS = 16;
const WIRE_HIT = 6;

const potentialClass = (p: NetPotential | undefined) => (p ? `p-${p}` : '');

const MOMENTARY = new Set<ComponentType>(['buttonNO', 'buttonNC']);
/** Her tıklamada onToggle: kilitlemeli elemanlar durum değiştirir, konveyöre kutu konur. */
const LATCHING = new Set<ComponentType>(['estop', 'breaker3', 'fuse', 'conveyor']);
const hasPush = (c: ComponentInstance) =>
  c.type === 'custom' && !!c.custom?.poles.some((p) => p.kind === 'pushNO' || p.kind === 'pushNC');
const isMomentary = (c: ComponentInstance) => MOMENTARY.has(c.type) || hasPush(c);
const isInteractive = (c: ComponentInstance) => isMomentary(c) || LATCHING.has(c.type);

/** Kablonun sürüklenebilir parçalarını bulmak için: terminal ve çıkış payı noktaları açıkça yer alır. */
function withStubs(path: Point[], a: Endpoint, b: Endpoint): Point[] {
  const raw = [{ x: a.x, y: a.y }, stubPoint(a), ...path.slice(1, -1), stubPoint(b), { x: b.x, y: b.y }];
  return raw.filter((p, i) => i === 0 || p.x !== raw[i - 1]!.x || p.y !== raw[i - 1]!.y);
}

export function Canvas(props: Props) {
  const { schematic, page, selection, dispatch, mode, snapshot, running } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState({ x: -20, y: -20, zoom: 1 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: 'none' });
  const [ghost, setGhost] = useState<Point | null>(null);
  const [touch, setTouch] = useState(false);

  const content = useMemo(() => pageContent(schematic, page), [schematic, page]);
  const byId = useMemo(() => new Map(content.components.map((c) => [c.id, c])), [content]);
  const selComps = useMemo(() => new Set(selection.components), [selection]);
  const selWires = useMemo(() => new Set(selection.wires), [selection]);
  const one = single(selection);

  // Kablo güzergâhları yalnız şema değişince hesaplanır (A*); sürüklerken etkilenenler basitçe çizilir.
  const routed = useMemo(() => routePage(content), [content]);

  const movedIds = gesture.kind === 'move' ? new Set(gesture.ids) : null;
  const placed = useCallback(
    (c: ComponentInstance): ComponentInstance =>
      gesture.kind === 'move' && gesture.ids.includes(c.id) ? { ...c, x: c.x + gesture.dx, y: c.y + gesture.dy } : c,
    [gesture],
  );

  const paths = useMemo(() => {
    if (gesture.kind !== 'move' && gesture.kind !== 'segment') return routed;
    const out = new Map(routed);
    for (const w of content.wires) {
      const ca = byId.get(w.a.component);
      const cb = byId.get(w.b.component);
      if (!ca || !cb) continue;
      if (gesture.kind === 'segment') {
        if (w.id === gesture.wire && gesture.points) out.set(w.id, manualRoute(gesture.a, gesture.b, gesture.points));
        continue;
      }
      const ma = movedIds!.has(ca.id);
      const mb = movedIds!.has(cb.id);
      if (!ma && !mb) continue;
      const ta = worldTerminal(placed(ca), w.a.terminal);
      const tb = worldTerminal(placed(cb), w.b.terminal);
      if (!ta || !tb) continue;
      const pts =
        w.points && ma && mb
          ? manualRoute(ta, tb, w.points.map((p) => ({ x: p.x + gesture.dx, y: p.y + gesture.dy })))
          : w.points
            ? manualRoute(ta, tb, w.points)
            : route(ta, tb);
      out.set(w.id, pts);
    }
    return out;
    // movedIds gesture'dan türetilir
  }, [routed, gesture, content, byId, placed]);

  const allTerminals = useMemo(() => content.components.flatMap((c) => worldTerminals(placed(c))), [content, placed]);

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

  // Tümünü sığdır (Zoom Extents). Boş sayfada sayfa çerçevesi sığdırılır. Boyut doğrudan ölçülür:
  // aynı commit'te değişen yerleşim (ör. alt panelin açılması) ResizeObserver'dan önce hesaba katılır.
  useEffect(() => {
    const host = hostRef.current;
    const b = unionBounds(content.components.map(bounds)) ?? { x: 0, y: 0, w: SHEET.w, h: SHEET.h };
    if (!host) return;
    const { width: w, height: h } = host.getBoundingClientRect();
    if (w < 10 || h < 10) return;
    const margin = 60;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(w / (b.w + margin * 2), h / (b.h + margin * 2))));
    setSize({ w, h });
    setCam({ zoom, x: b.x + b.w / 2 - w / zoom / 2, y: b.y + b.h / 2 - h / zoom / 2 });
    // Yalnız istek geldiğinde veya sayfa değişince çalışır (kamera veya şema değişince değil)
  }, [props.fitSignal, page]);

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

  // Esc: yarım kalan işlemi iptal et. Kablo çizerken Backspace son köşe noktasını geri alır
  // (yakalama aşamasında dinlenir; seçimi silme kısayoluna ulaşmaz).
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gestureRef.current;
      if (e.key === 'Escape') setGesture({ kind: 'none' });
      else if ((e.key === 'Backspace' || e.key === 'Delete') && g.kind === 'wire') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (g.points.length) setGesture({ ...g, points: g.points.slice(0, -1) });
        else setGesture({ kind: 'none' });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Mod veya sayfa değişince yarım kalan işlemi bırak
  useEffect(() => setGesture({ kind: 'none' }), [mode, page]);

  const nearestTerminal = useCallback(
    (p: Point, exclude?: TerminalRef): WorldTerminal | null => {
      let best: WorldTerminal | null = null;
      let bestD = (touch ? TOUCH_SNAP_RADIUS : SNAP_RADIUS) / Math.min(1, cam.zoom);
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
    [allTerminals, touch, cam.zoom],
  );

  /** İmlecin altındaki kablo ve üzerindeki ızgaraya oturmuş nokta. */
  const wireAt = useCallback(
    (p: Point, exclude?: TerminalRef): { id: string; point: Point } | null => {
      let best: { id: string; point: Point; d: number } | null = null;
      for (const w of content.wires) {
        if (exclude && [w.a, w.b].some((r) => r.component === exclude.component && r.terminal === exclude.terminal)) continue;
        const pts = paths.get(w.id);
        if (!pts) continue;
        const near = nearestOnPath(pts, p);
        if (near.distance <= WIRE_HIT && (!best || near.distance < best.d)) {
          best = { id: w.id, point: { x: snap(near.point.x), y: snap(near.point.y) }, d: near.distance };
        }
      }
      return best && { id: best.id, point: best.point };
    },
    [content.wires, paths],
  );

  /**
   * Kablo ucunu bırakma: terminale bağlan, yoksa kablonun ortasına (bağlantı noktası). Boşlukta
   * kablo kaybolmaz: tıklanan yer köşe noktası olur ve çizim oradan devam eder.
   */
  const extendWire = (g: Extract<Gesture, { kind: 'wire' }>, p: Point) => {
    const points = g.points.length ? g.points : undefined;
    const term = nearestTerminal(p, g.from.ref);
    if (term) {
      dispatch({ type: 'connect', a: g.from.ref, b: term.ref, points });
      setGesture({ kind: 'none' });
      return;
    }
    const hit = wireAt(p, g.from.ref);
    if (hit) {
      dispatch({ type: 'connectToWire', from: g.from.ref, wire: hit.id, x: hit.point.x, y: hit.point.y, points });
      setGesture({ kind: 'none' });
      return;
    }
    const q = { x: snap(p.x), y: snap(p.y) };
    const last = g.points[g.points.length - 1] ?? stubPoint(g.from);
    const same = last.x === q.x && last.y === q.y;
    setGesture({ ...g, sticky: true, points: same ? g.points : [...g.points, q] });
  };

  // --- İşaretçi olayları ----------------------------------------------------------------

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const isTouch = e.pointerType === 'touch';
    if (isTouch !== touch) setTouch(isTouch);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    // İki parmak: yakınlaştır/kaydır (sürmekte olan işlem iptal)
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()] as [Point, Point];
      setGesture({
        kind: 'pinch',
        dist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        cam,
      });
      return;
    }

    const p = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;
    const compEl = target.closest('[data-comp]');
    const wireEl = target.closest('[data-wire]');
    const segEl = target.closest('[data-seg]');
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    const startPan = () => setGesture({ kind: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y });

    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      startPan();
      return;
    }
    if (e.button !== 0) return;

    if (mode === 'sim') {
      const id = compEl?.getAttribute('data-comp');
      const c = id ? byId.get(id) : undefined;
      if (c) {
        dispatch({ type: 'select', selection: selectComponent(c.id) });
        if (LATCHING.has(c.type)) {
          props.onToggle(c.id);
        } else if (isMomentary(c)) {
          if (running) {
            props.onButton(c.id, true);
            setGesture({ kind: 'press', id: c.id });
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
    if (props.placing) {
      const g = geometryOf(props.placing);
      const { type, custom } = props.placing;
      dispatch({ type: 'add', componentType: type, x: snap(p.x - g.w / 2), y: snap(p.y - g.h / 2), page, custom });
      props.onPlaced();
      return;
    }
    if (gesture.kind === 'wire' && gesture.sticky) {
      extendWire(gesture, p);
      return;
    }
    const term = nearestTerminal(p);
    if (term) {
      setGesture({ kind: 'wire', from: term, points: [], sticky: false, startX: e.clientX, startY: e.clientY });
      return;
    }
    // Seçili kablonun parça tutamağı
    const segIndex = segEl?.getAttribute('data-seg');
    if (segIndex && one?.kind === 'wire') {
      const w = content.wires.find((x) => x.id === one.id);
      const ca = w && byId.get(w.a.component);
      const cb = w && byId.get(w.b.component);
      const a = ca && w && worldTerminal(ca, w.a.terminal);
      const b = cb && w && worldTerminal(cb, w.b.terminal);
      const path = w && paths.get(w.id);
      if (w && a && b && path) {
        setGesture({ kind: 'segment', wire: w.id, full: withStubs(path, a, b), segment: Number(segIndex), a, b, points: null });
        return;
      }
    }
    const compId = compEl?.getAttribute('data-comp');
    if (compId) {
      if (additive) {
        const next = selComps.has(compId)
          ? { ...selection, components: selection.components.filter((x) => x !== compId) }
          : { ...selection, components: [...selection.components, compId] };
        dispatch({ type: 'select', selection: next });
        return;
      }
      const ids = selComps.has(compId) ? selection.components : [compId];
      if (!selComps.has(compId)) dispatch({ type: 'select', selection: selectComponent(compId) });
      setGesture({ kind: 'move', ids, start: p, dx: 0, dy: 0 });
      return;
    }
    const wireId = wireEl?.getAttribute('data-wire');
    if (wireId) {
      if (additive) {
        const next = selWires.has(wireId)
          ? { ...selection, wires: selection.wires.filter((x) => x !== wireId) }
          : { ...selection, wires: [...selection.wires, wireId] };
        dispatch({ type: 'select', selection: next });
      } else {
        dispatch({ type: 'select', selection: selectWire(wireId) });
      }
      return;
    }
    if (isTouch) {
      startPan();
      return;
    }
    setGesture({ kind: 'box', box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, additive });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    switch (gesture.kind) {
      case 'pan':
        setCam((c) => ({
          ...c,
          x: gesture.camX - (e.clientX - gesture.startX) / c.zoom,
          y: gesture.camY - (e.clientY - gesture.startY) / c.zoom,
        }));
        break;
      case 'pinch': {
        if (pointers.current.size < 2) break;
        const [p1, p2] = [...pointers.current.values()] as [Point, Point];
        const r = svgRef.current!.getBoundingClientRect();
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const c0 = gesture.cam;
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (c0.zoom * dist) / Math.max(1, gesture.dist)));
        // Başlangıçtaki parmak ortasının altındaki dünya noktası yeni parmak ortasının altında kalır.
        const wx = c0.x + (gesture.mid.x - r.left) / c0.zoom;
        const wy = c0.y + (gesture.mid.y - r.top) / c0.zoom;
        setCam({ zoom, x: wx - (mid.x - r.left) / zoom, y: wy - (mid.y - r.top) / zoom });
        break;
      }
      case 'move': {
        const dx = snap(p.x - gesture.start.x);
        const dy = snap(p.y - gesture.start.y);
        if (dx !== gesture.dx || dy !== gesture.dy) setGesture({ ...gesture, dx, dy });
        break;
      }
      case 'box':
        setGesture({ ...gesture, box: { ...gesture.box, x1: p.x, y1: p.y } });
        break;
      case 'segment': {
        const points = dragSegment(gesture.full, gesture.segment, p);
        setGesture({ ...gesture, points });
        break;
      }
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    switch (gesture.kind) {
      case 'move':
        if (gesture.dx || gesture.dy) dispatch({ type: 'moveMany', ids: gesture.ids, dx: gesture.dx, dy: gesture.dy });
        setGesture({ kind: 'none' });
        break;
      case 'box': {
        const { box } = gesture;
        const tiny = Math.abs(box.x1 - box.x0) * cam.zoom < 3 && Math.abs(box.y1 - box.y0) * cam.zoom < 3;
        const hit = tiny ? { components: [], wires: [] } : boxSelect(content, paths, box);
        const next = gesture.additive
          ? {
              components: [...new Set([...selection.components, ...hit.components])],
              wires: [...new Set([...selection.wires, ...hit.wires])],
            }
          : hit;
        dispatch({ type: 'select', selection: next });
        setGesture({ kind: 'none' });
        break;
      }
      case 'wire': {
        if (gesture.sticky) break;
        const clicked = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < 4;
        if (clicked) {
          // Tıkla-tıkla modu: sonraki tıklamalar köşe noktası bırakır veya hedefi seçer
          setGesture({ ...gesture, sticky: true });
        } else {
          extendWire(gesture, p);
        }
        break;
      }
      case 'segment':
        if (gesture.points) dispatch({ type: 'setWirePoints', id: gesture.wire, points: gesture.points });
        setGesture({ kind: 'none' });
        break;
      case 'press':
        props.onButton(gesture.id, false);
        setGesture({ kind: 'none' });
        break;
      case 'pan':
        setGesture({ kind: 'none' });
        break;
      case 'pinch':
        if (pointers.current.size < 2) setGesture({ kind: 'none' });
        break;
    }
  };

  const onDoubleClick = (e: MouseEvent<SVGSVGElement>) => {
    const id = (e.target as Element).closest('[data-comp]')?.getAttribute('data-comp');
    const c = id ? byId.get(id) : undefined;
    if (c?.type !== 'xref') return;
    const target = xrefTargets(schematic, c)[0];
    if (target) props.onJump(target.page, target.component);
  };

  // --- Kütüphaneden bırakma ---------------------------------------------------------------

  const dropPosition = (e: DragEvent, item: DragItem): Point => {
    const p = toWorld(e.clientX, e.clientY);
    const g = geometryOf(item);
    return { x: snap(p.x - g.w / 2), y: snap(p.y - g.h / 2) };
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (mode !== 'edit' || !props.drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setGhost(dropPosition(e, props.drag));
    setCursor(toWorld(e.clientX, e.clientY));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const data = e.dataTransfer.getData(DRAG_MIME);
    setGhost(null);
    if (mode !== 'edit' || !data) return;
    let item: DragItem | null = null;
    if (data.startsWith('custom:')) {
      const def = schematic.library?.find((d) => d.id === data.slice(7));
      if (def) item = { type: 'custom', custom: def };
    } else if (data !== 'custom') {
      item = { type: data as ComponentType };
    }
    if (!item) return;
    e.preventDefault();
    const pos = dropPosition(e, item);
    dispatch({ type: 'add', componentType: item.type, x: pos.x, y: pos.y, page, custom: item.custom });
  };

  // --- Çizim ------------------------------------------------------------------------------

  const vw = size.w / cam.zoom;
  const vh = size.h / cam.zoom;
  const potentials = snapshot?.potentials;
  const hoverTerm =
    mode === 'edit' && cursor && !['pan', 'move', 'box', 'segment', 'pinch'].includes(gesture.kind)
      ? nearestTerminal(cursor)
      : null;
  const wireTarget =
    mode === 'edit' && gesture.kind === 'wire' && cursor && !nearestTerminal(cursor, gesture.from.ref)
      ? wireAt(cursor, gesture.from.ref)
      : null;

  const pages = pagesOf(schematic);
  const pageIndex = pages.findIndex((p) => p.id === page);

  const wirePaths = content.wires.map((w) => {
    const pts = paths.get(w.id);
    if (!pts) return null;
    const selected = selWires.has(w.id);
    const pot = potentials?.[terminalKey(w.a)];
    let handles: [Point, Point][] = [];
    if (mode === 'edit' && one?.kind === 'wire' && one.id === w.id && gesture.kind !== 'segment') {
      const ca = byId.get(w.a.component);
      const cb = byId.get(w.b.component);
      const a = ca && worldTerminal(ca, w.a.terminal);
      const b = cb && worldTerminal(cb, w.b.terminal);
      if (a && b) {
        const full = withStubs(pts, a, b);
        handles = full.slice(0, -1).map((p, i): [Point, Point] => [p, full[i + 1]!]);
      }
    }
    return (
      <g
        key={w.id}
        data-wire={w.id}
        className={`wire ${potentialClass(pot)}${selected ? ' selected' : ''}${w.points ? ' manual' : ''}`}
      >
        <path d={toPath(pts)} className="wire-hit" />
        <path d={toPath(pts)} className="wire-line" />
        {selected &&
          [pts[0]!, pts[pts.length - 1]!].map((t, i) => (
            <rect key={i} x={t.x - 3} y={t.y - 3} width={6} height={6} className="grip" />
          ))}
        {handles.map(([p, q], i) =>
          i >= 1 && i <= handles.length - 2 ? (
            <rect
              key={`s${i}`}
              data-seg={i}
              x={(p.x + q.x) / 2 - 4}
              y={(p.y + q.y) / 2 - 4}
              width={8}
              height={8}
              className={`seg-grip ${p.y === q.y ? 'ns' : 'ew'}`}
            >
              <title>Parçayı sürükleyerek kabloyu şekillendirin</title>
            </rect>
          ) : null,
        )}
      </g>
    );
  });

  let rubber: Point[] | null = null;
  if (gesture.kind === 'wire' && cursor) {
    const target = nearestTerminal(cursor, gesture.from.ref);
    const end = target ?? wireTarget?.point ?? { x: snap(cursor.x), y: snap(cursor.y) };
    if (gesture.points.length === 0) rubber = route(gesture.from, target ?? { ...end, free: true });
    else if (target) rubber = manualRoute(gesture.from, target, gesture.points);
    else rubber = orthoJoin([gesture.from, stubPoint(gesture.from), ...gesture.points, end]);
  }

  const box = gesture.kind === 'box' ? gesture.box : null;

  return (
    <div
      ref={hostRef}
      className={`canvas-host mode-${mode}${running ? ' running' : ''}`}
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
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          setGesture({ kind: 'none' });
        }}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={onDoubleClick}
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

        {/* Sayfa çerçevesi ve antet */}
        <g className="sheet">
          <rect x={0} y={0} width={SHEET.w} height={SHEET.h} className="sheet-frame" />
          <g transform={`translate(${SHEET.w - SHEET.titleW} ${SHEET.h - SHEET.titleH})`}>
            <rect width={SHEET.titleW} height={SHEET.titleH} className="title-block" />
            <line x1={0} y1={30} x2={SHEET.titleW} y2={30} />
            <line x1={SHEET.titleW - 90} y1={0} x2={SHEET.titleW - 90} y2={SHEET.titleH} />
            <text x={8} y={12} className="tb-caption">PROJE</text>
            <text x={8} y={25} className="tb-value">{schematic.title || 'Adsız proje'}</text>
            <text x={8} y={42} className="tb-caption">SAYFA</text>
            <text x={8} y={55} className="tb-value">{pages[pageIndex]?.title ?? ''}</text>
            <text x={SHEET.titleW - 82} y={12} className="tb-caption">PLC-SIM</text>
            <text x={SHEET.titleW - 82} y={42} className="tb-caption">NO</text>
            <text x={SHEET.titleW - 82} y={55} className="tb-value">
              {pageIndex + 1} / {pages.length}
            </text>
          </g>
        </g>

        <g className="wires">{wirePaths}</g>

        {content.components.map((c0) => {
          const c = placed(c0);
          const g = geometryOf(c);
          const b = bounds(c);
          const selected = selComps.has(c.id);
          const interactive = mode === 'sim' && isInteractive(c);
          const xrefText = c.type === 'xref' ? xrefTargets(schematic, c).map((t) => t.label).join(' ') : undefined;
          return (
            <g key={c.id} className={`component${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`}>
              {selected && <rect x={b.x - 6} y={b.y - 6} width={b.w + 12} height={b.h + 12} className="selection-box" />}
              <g data-comp={c.id} transform={`translate(${c.x} ${c.y}) rotate(${c.rotation} ${g.w / 2} ${g.h / 2})`}>
                <rect width={g.w} height={g.h} className="body-hit" />
                <g className="symbol">
                  <SymbolBody inst={c} state={snapshot?.components[c.id]} xrefText={xrefText} />
                </g>
                {c.type !== 'junction' &&
                  c.type !== 'xref' &&
                  g.terminals.map((t) => (
                    <text key={t.name} x={t.x + 3} y={t.dir === 'up' ? 9 : t.y - 3} className="term-label">
                      {t.name}
                    </text>
                  ))}
              </g>
              {c.type === 'xref' ? (
                <text x={b.x + b.w / 2} y={b.y - 4} className="tag xref-tag">
                  {c.name}
                </text>
              ) : (
                c.type !== 'junction' && (
                  <text x={b.x} y={b.y - 5} className="tag">
                    {c.name}
                  </text>
                )
              )}
              {c.type !== 'junction' &&
                worldTerminals(c).map((t) => (
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
        {gesture.kind === 'wire' && gesture.points.length > 0 && (
          <g className="wire-draft">
            <path d={toPath(orthoJoin([gesture.from, stubPoint(gesture.from), ...gesture.points]))} />
            {gesture.points.map((q, i) => (
              <rect key={i} x={q.x - 2.5} y={q.y - 2.5} width={5} height={5} />
            ))}
          </g>
        )}
        {wireTarget && <circle cx={wireTarget.point.x} cy={wireTarget.point.y} r={5} className="osnap" />}

        {box && (
          <rect
            x={Math.min(box.x0, box.x1)}
            y={Math.min(box.y0, box.y1)}
            width={Math.abs(box.x1 - box.x0)}
            height={Math.abs(box.y1 - box.y0)}
            className={box.x1 < box.x0 ? 'select-box crossing' : 'select-box'}
          />
        )}

        {ghost && props.drag && (
          <g transform={`translate(${ghost.x} ${ghost.y})`} className="ghost">
            <g className="symbol">
              <SymbolBody inst={props.drag} />
            </g>
          </g>
        )}
        {props.placing && cursor && mode === 'edit' && (
          <g
            transform={`translate(${snap(cursor.x - geometryOf(props.placing).w / 2)} ${snap(cursor.y - geometryOf(props.placing).h / 2)})`}
            className="ghost"
          >
            <g className="symbol">
              <SymbolBody inst={props.placing} />
            </g>
          </g>
        )}

        {hoverTerm && (
          <rect x={hoverTerm.x - 5} y={hoverTerm.y - 5} width={10} height={10} className="osnap">
            <title>{hoverTerm.name}</title>
          </rect>
        )}

        {mode === 'edit' && cursor && !touch && gesture.kind !== 'pan' && (
          <path
            d={`M ${cam.x} ${cursor.y} H ${cam.x + vw} M ${cursor.x} ${cam.y} V ${cam.y + vh}`}
            className="crosshair"
          />
        )}
      </svg>
      {mode === 'edit' && props.placing && (
        <div className="canvas-prompt">
          Yerleştir: <strong>{props.placing.custom?.title ?? props.placing.type}</strong> → konuma tıklayın (Esc iptal)
        </div>
      )}
      {mode === 'edit' && gesture.kind === 'wire' && (
        <div className="canvas-prompt">
          Kablo: <strong>{byId.get(gesture.from.ref.component)?.name}:{gesture.from.name}</strong> → hedef terminali
          veya dallanılacak kabloyu seçin; boşluğa tıklama köşe bırakır (Backspace geri al, Esc iptal)
        </div>
      )}
      {mode === 'edit' && content.components.length === 0 && (
        <div className="canvas-empty">Kütüphaneden bir elemanı sürükleyip bu sayfaya bırakın</div>
      )}
    </div>
  );
}
