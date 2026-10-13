// Editör dokümanı: şema + seçim + geri al/yinele geçmişi. Saf reducer, React'tan bağımsız.

import type { ModbusPoll } from '../../sim/modbusMaster';
import { isController } from '../../sim/ioConfig';
import { CATALOG, prefixOf, terminalDomain, terminalsOf, type ComponentType, type CustomDef, type ParamValue } from '../../sim/catalog';
import type { LadderProgram } from '../../sim/ladder';
import {
  pageOf,
  pagesOf,
  sameTerminal,
  type ComponentInstance,
  type Point,
  type Rotation,
  type Schematic,
  type Task,
  type TerminalRef,
  type Wire,
} from '../../sim/schematic';
import { geometryOf } from './geometry';

/** Seçili bileşenler ve kablolar (ikisi de boş olabilir). */
export interface Selection {
  components: string[];
  wires: string[];
}

export const EMPTY_SELECTION: Selection = { components: [], wires: [] };
export const selectComponent = (id: string): Selection => ({ components: [id], wires: [] });
export const selectWire = (id: string): Selection => ({ components: [], wires: [id] });
export const isEmpty = (s: Selection) => s.components.length === 0 && s.wires.length === 0;

/** Tek bir eleman seçiliyse onu döndürür. */
export function single(s: Selection): { kind: 'component' | 'wire'; id: string } | null {
  if (s.components.length === 1 && s.wires.length === 0) return { kind: 'component', id: s.components[0]! };
  if (s.wires.length === 1 && s.components.length === 0) return { kind: 'wire', id: s.wires[0]! };
  return null;
}

export interface Clipboard {
  components: ComponentInstance[];
  wires: Wire[];
}

export interface EditorState {
  schematic: Schematic;
  selection: Selection;
  past: Schematic[];
  future: Schematic[];
}

export type EditorAction =
  | { type: 'add'; componentType: ComponentType; x: number; y: number; page: string; custom?: CustomDef }
  | { type: 'moveMany'; ids: string[]; dx: number; dy: number }
  | { type: 'rotate'; ids: string[] }
  | { type: 'rename'; id: string; name: string }
  | { type: 'setParam'; id: string; key: string; value: ParamValue }
  /** Birden çok parametre tek geri alma adımında (ör. G/Ç otomatik yapılandırma). */
  | { type: 'setParams'; id: string; params: Record<string, ParamValue> }
  | { type: 'setProgram'; id: string; program: LadderProgram }
  | { type: 'setPolls'; id: string; polls: ModbusPoll[] }
  /** points: kablo çizilirken tıklanan ara noktalar (elle güzergâh). */
  | { type: 'connect'; a: TerminalRef; b: TerminalRef; points?: Point[] }
  /** Kablonun ortasına bağlanma: (x, y)'de bağlantı noktası oluşturur, kabloyu böler. */
  | { type: 'connectToWire'; from: TerminalRef; wire: string; x: number; y: number; points?: Point[] }
  | { type: 'setWirePoints'; id: string; points: Point[] | undefined }
  | { type: 'deleteSelection' }
  | { type: 'select'; selection: Selection }
  | { type: 'paste'; clip: Clipboard; dx: number; dy: number; page: string }
  | { type: 'addPage'; id: string; title: string }
  | { type: 'renamePage'; id: string; title: string }
  | { type: 'deletePage'; id: string }
  | { type: 'setTitle'; title: string }
  /** Simülasyon başında etkin arızalar (arıza bulma alıştırması). */
  | { type: 'setFaults'; id: string; faults: string[] }
  | { type: 'setWireBroken'; id: string; broken: boolean }
  | { type: 'setHideFaults'; hide: boolean }
  | { type: 'setTask'; task: Task | undefined }
  | { type: 'defineCustom'; def: CustomDef }
  | { type: 'deleteCustom'; id: string }
  | { type: 'load'; schematic: Schematic }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 100;

export const initEditor = (schematic: Schematic): EditorState => ({
  schematic,
  selection: EMPTY_SELECTION,
  past: [],
  future: [],
});

export function nextId(prefix: string, used: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of used) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** Aynı önekli en küçük boş numara (K1, K2...). */
export function nextName(schematic: Schematic, inst: Pick<ComponentInstance, 'type' | 'custom'>, taken?: Set<string>): string {
  const prefix = prefixOf(inst);
  const names = taken ?? new Set(schematic.components.map((c) => c.name));
  for (let i = 1; ; i++) if (!names.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

function commit(state: EditorState, schematic: Schematic, selection: Selection = state.selection): EditorState {
  return {
    schematic,
    selection,
    past: [...state.past, state.schematic].slice(-HISTORY_LIMIT),
    future: [],
  };
}

function updateComponent(s: Schematic, id: string, fn: (c: ComponentInstance) => ComponentInstance): Schematic {
  return { ...s, components: s.components.map((c) => (c.id === id ? fn(c) : c)) };
}

/** Kablosu kalmamış bağlantı noktalarını siler. */
function pruneJunctions(s: Schematic): Schematic {
  const used = new Set(s.wires.flatMap((w) => [w.a.component, w.b.component]));
  const components = s.components.filter((c) => c.type !== 'junction' || used.has(c.id));
  return components.length === s.components.length ? s : { ...s, components };
}

/** Terminali artık var olmayan kabloları siler (ör. kullanıcı bileşeni tanımı değişince). */
function pruneDanglingWires(s: Schematic): Schematic {
  const byId = new Map(s.components.map((c) => [c.id, c]));
  const ok = (r: TerminalRef) => {
    const c = byId.get(r.component);
    return !!c && terminalsOf(c).includes(r.terminal);
  };
  const wires = s.wires.filter((w) => ok(w.a) && ok(w.b));
  return wires.length === s.wires.length ? s : { ...s, wires };
}

/** Seçimi panoya kopyalar: seçili bileşenler ve iki ucu da seçimde olan kablolar. */
export function copySelection(s: Schematic, sel: Selection): Clipboard {
  const ids = new Set(sel.components);
  return structuredClone({
    components: s.components.filter((c) => ids.has(c.id)),
    wires: s.wires.filter((w) => ids.has(w.a.component) && ids.has(w.b.component)),
  });
}

function newComponent(
  s: Schematic,
  type: ComponentType,
  x: number,
  y: number,
  page: string,
  custom?: CustomDef,
): ComponentInstance {
  const id = nextId('c', s.components.map((c) => c.id));
  const c: ComponentInstance = { id, type, name: '', x, y, rotation: 0, page };
  if (custom) c.custom = structuredClone(custom);
  if (type === 'plc' || type === 'esp32') c.program = { networks: [] };
  c.name = nextName(s, c);
  return c;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const s = state.schematic;
  switch (action.type) {
    case 'add': {
      if (action.componentType === 'custom' && !action.custom) return state;
      const c = newComponent(s, action.componentType, action.x, action.y, action.page, action.custom);
      return commit(state, { ...s, components: [...s.components, c] }, selectComponent(c.id));
    }
    case 'moveMany': {
      const ids = new Set(action.ids);
      const { dx, dy } = action;
      if ((!dx && !dy) || ids.size === 0) return state;
      const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
      return commit(state, {
        ...s,
        components: s.components.map((c) => (ids.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
        // İki ucu birlikte taşınan kablonun elle verilmiş güzergâhı da taşınır.
        wires: s.wires.map((w) =>
          w.points && ids.has(w.a.component) && ids.has(w.b.component) ? { ...w, points: w.points.map(shift) } : w,
        ),
      });
    }
    case 'rotate': {
      const ids = new Set(action.ids.filter((id) => s.components.some((c) => c.id === id)));
      if (ids.size === 0) return state;
      return commit(state, {
        ...s,
        components: s.components.map((c) =>
          ids.has(c.id) ? { ...c, rotation: ((c.rotation + 90) % 360) as Rotation } : c,
        ),
      });
    }
    case 'rename': {
      const name = action.name.trim();
      const c = s.components.find((c) => c.id === action.id);
      if (!c || !name || c.name === name) return state;
      return commit(state, updateComponent(s, action.id, (c) => ({ ...c, name })));
    }
    case 'setParam': {
      const c = s.components.find((c) => c.id === action.id);
      if (!c || !CATALOG[c.type].params.some((p) => p.key === action.key) || c.params?.[action.key] === action.value) {
        return state;
      }
      return commit(
        state,
        updateComponent(s, action.id, (c) => ({ ...c, params: { ...c.params, [action.key]: action.value } })),
      );
    }
    case 'setParams': {
      const c = s.components.find((c) => c.id === action.id);
      if (!c) return state;
      const known = Object.entries(action.params).filter(([k]) => CATALOG[c.type].params.some((p) => p.key === k));
      if (known.every(([k, v]) => c.params?.[k] === v)) return state;
      return commit(
        state,
        updateComponent(s, action.id, (c) => ({ ...c, params: { ...c.params, ...Object.fromEntries(known) } })),
      );
    }
    case 'setPolls': {
      const c = s.components.find((c) => c.id === action.id);
      if (!c || c.type !== 'plc' || c.modbusPolls === action.polls) return state;
      return commit(state, updateComponent(s, action.id, (c) => ({ ...c, modbusPolls: action.polls })));
    }
    case 'setProgram': {
      const c = s.components.find((c) => c.id === action.id);
      if (!c || !isController(c.type) || c.program === action.program) return state;
      return commit(state, updateComponent(s, action.id, (c) => ({ ...c, program: action.program })));
    }
    case 'connect': {
      const { a, b } = action;
      if (sameTerminal(a, b) || !sameDomain(s, a, b)) return state;
      const exists = s.wires.some(
        (w) => (sameTerminal(w.a, a) && sameTerminal(w.b, b)) || (sameTerminal(w.a, b) && sameTerminal(w.b, a)),
      );
      if (exists) return state;
      const id = nextId('w', s.wires.map((w) => w.id));
      const wire = action.points?.length ? { id, a, b, points: action.points } : { id, a, b };
      return commit(state, { ...s, wires: [...s.wires, wire] }, selectWire(id));
    }
    case 'connectToWire': {
      const w = s.wires.find((w) => w.id === action.wire);
      if (!w) return state;
      if (sameTerminal(w.a, action.from) || sameTerminal(w.b, action.from) || !sameDomain(s, w.a, action.from)) return state;
      const host = s.components.find((c) => c.id === w.a.component);
      const page = host ? pageOf(s, host) : pagesOf(s)[0]!.id;
      const g = geometryOf({ type: 'junction' });
      const j = newComponent(s, 'junction', action.x - g.w / 2, action.y - g.h / 2, page);
      const jt: TerminalRef = { component: j.id, terminal: '1' };
      const ids = s.wires.map((x) => x.id);
      const w1 = nextId('w', ids);
      const w2 = nextId('w', [...ids, w1]);
      const w3 = nextId('w', [...ids, w1, w2]);
      return commit(
        state,
        {
          ...s,
          components: [...s.components, j],
          wires: [
            ...s.wires.filter((x) => x.id !== w.id),
            { id: w1, a: w.a, b: jt },
            { id: w2, a: jt, b: w.b },
            action.points?.length ? { id: w3, a: action.from, b: jt, points: action.points } : { id: w3, a: action.from, b: jt },
          ],
        },
        selectWire(w3),
      );
    }
    case 'setWirePoints': {
      const w = s.wires.find((w) => w.id === action.id);
      if (!w || (!w.points && !action.points)) return state;
      return commit(state, {
        ...s,
        wires: s.wires.map((x) => {
          if (x.id !== action.id) return x;
          const { points: _, ...rest } = x;
          return action.points ? { ...rest, points: action.points } : rest;
        }),
      });
    }
    case 'deleteSelection': {
      const sel = state.selection;
      if (isEmpty(sel)) return state;
      const comps = new Set(sel.components);
      const wires = new Set(sel.wires);
      const next = pruneJunctions({
        ...s,
        components: s.components.filter((c) => !comps.has(c.id)),
        wires: s.wires.filter((w) => !wires.has(w.id) && !comps.has(w.a.component) && !comps.has(w.b.component)),
      });
      return commit(state, next, EMPTY_SELECTION);
    }
    case 'select': {
      const comps = new Set(s.components.map((c) => c.id));
      const wires = new Set(s.wires.map((w) => w.id));
      return {
        ...state,
        selection: {
          components: action.selection.components.filter((id) => comps.has(id)),
          wires: action.selection.wires.filter((id) => wires.has(id)),
        },
      };
    }
    case 'paste': {
      const { clip, dx, dy } = action;
      if (clip.components.length === 0) return state;
      const usedIds = s.components.map((c) => c.id);
      const usedWireIds = s.wires.map((w) => w.id);
      const names = new Set(s.components.map((c) => c.name));
      const idMap = new Map<string, string>();
      const components = clip.components.map((src) => {
        const id = nextId('c', usedIds);
        usedIds.push(id);
        idMap.set(src.id, id);
        // Sayfa geçişleri adlarıyla bağlanır: adları korunur. Diğerleri yeni numara alır.
        const name = src.type === 'xref' ? src.name : nextName(s, src, names);
        names.add(name);
        return { ...structuredClone(src), id, name, x: src.x + dx, y: src.y + dy, page: action.page };
      });
      const mapRef = (r: TerminalRef): TerminalRef => ({ component: idMap.get(r.component)!, terminal: r.terminal });
      const wires = clip.wires
        .filter((w) => idMap.has(w.a.component) && idMap.has(w.b.component))
        .map((w) => {
          const id = nextId('w', usedWireIds);
          usedWireIds.push(id);
          const out: Wire = { id, a: mapRef(w.a), b: mapRef(w.b) };
          if (w.points) out.points = w.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          return out;
        });
      return commit(
        state,
        { ...s, components: [...s.components, ...components], wires: [...s.wires, ...wires] },
        { components: components.map((c) => c.id), wires: wires.map((w) => w.id) },
      );
    }
    case 'addPage': {
      const pages = pagesOf(s);
      if (pages.some((p) => p.id === action.id)) return state;
      return commit(state, { ...s, pages: [...pages, { id: action.id, title: action.title }] });
    }
    case 'renamePage': {
      const title = action.title.trim();
      const pages = pagesOf(s);
      if (!title || !pages.some((p) => p.id === action.id && p.title !== title)) return state;
      return commit(state, { ...s, pages: pages.map((p) => (p.id === action.id ? { ...p, title } : p)) });
    }
    case 'deletePage': {
      const pages = pagesOf(s);
      if (pages.length <= 1 || !pages.some((p) => p.id === action.id)) return state;
      const gone = new Set(s.components.filter((c) => pageOf(s, c) === action.id).map((c) => c.id));
      // İlk sayfa silinirse sayfası belirtilmemiş elemanlar yeni ilk sayfaya kayar: sayfayı sabitle.
      const rest = pages.filter((p) => p.id !== action.id);
      return commit(
        state,
        pruneJunctions({
          ...s,
          pages: rest,
          components: s.components.filter((c) => !gone.has(c.id)).map((c) => ({ ...c, page: pageOf(s, c) })),
          wires: s.wires.filter((w) => !gone.has(w.a.component) && !gone.has(w.b.component)),
        }),
        EMPTY_SELECTION,
      );
    }
    case 'setFaults': {
      const c = s.components.find((c) => c.id === action.id);
      if (!c) return state;
      const faults = [...new Set(action.faults)];
      if ((c.faults ?? []).join() === faults.join()) return state;
      return commit(
        state,
        updateComponent(s, action.id, (c) => {
          const { faults: _old, ...rest } = c;
          return faults.length ? { ...rest, faults } : rest;
        }),
      );
    }
    case 'setWireBroken': {
      const w = s.wires.find((w) => w.id === action.id);
      if (!w || !!w.broken === action.broken) return state;
      return commit(state, {
        ...s,
        wires: s.wires.map((x) => {
          if (x.id !== action.id) return x;
          const { broken: _old, ...rest } = x;
          return action.broken ? { ...rest, broken: true } : rest;
        }),
      });
    }
    case 'setHideFaults': {
      if (!!s.hideFaults === action.hide) return state;
      const { hideFaults: _old, ...rest } = s;
      return commit(state, action.hide ? { ...rest, hideFaults: true } : rest);
    }
    case 'setTask': {
      if (JSON.stringify(s.task) === JSON.stringify(action.task)) return state;
      const { task: _old, ...rest } = s;
      return commit(state, action.task ? { ...rest, task: action.task } : rest);
    }
    case 'setTitle': {
      const title = action.title.trim();
      if (title === (s.title ?? '')) return state;
      return commit(state, { ...s, title });
    }
    case 'defineCustom': {
      const def = structuredClone(action.def);
      const library = s.library ?? [];
      const exists = library.some((d) => d.id === def.id);
      const next = pruneDanglingWires({
        ...s,
        library: exists ? library.map((d) => (d.id === def.id ? def : d)) : [...library, def],
        components: s.components.map((c) =>
          c.type === 'custom' && c.custom?.id === def.id ? { ...c, custom: structuredClone(def) } : c,
        ),
      });
      return commit(state, next);
    }
    case 'deleteCustom': {
      if (!s.library?.some((d) => d.id === action.id)) return state;
      // Şemadaki örnekler tanımlarının kopyasını taşıdığı için çalışmaya devam eder.
      return commit(state, { ...s, library: s.library.filter((d) => d.id !== action.id) });
    }
    case 'load':
      return commit(state, action.schematic, EMPTY_SELECTION);
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { schematic: prev, selection: EMPTY_SELECTION, past: state.past.slice(0, -1), future: [s, ...state.future] };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { schematic: next, selection: EMPTY_SELECTION, past: [...state.past, s], future: state.future.slice(1) };
    }
  }
}

/** İki terminal aynı fiziksel alanda mı (elektrik / pnömatik / hidrolik); bağlantı noktası her alana uyar. */
export function sameDomain(s: Schematic, a: TerminalRef, b: TerminalRef): boolean {
  const ca = s.components.find((c) => c.id === a.component);
  const cb = s.components.find((c) => c.id === b.component);
  if (!ca || !cb || ca.type === 'junction' || cb.type === 'junction') return true;
  return terminalDomain(ca, a.terminal) === terminalDomain(cb, b.terminal);
}
