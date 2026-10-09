// Editör dokümanı: şema + seçim + geri al/yinele geçmişi. Saf reducer, React'tan bağımsız.

import { CATALOG, type ComponentType } from '../../sim/catalog';
import { sameTerminal, type ComponentInstance, type Rotation, type Schematic, type TerminalRef } from '../../sim/schematic';

export type Selection = { kind: 'component'; id: string } | { kind: 'wire'; id: string } | null;

export interface EditorState {
  schematic: Schematic;
  selection: Selection;
  past: Schematic[];
  future: Schematic[];
}

export type EditorAction =
  | { type: 'add'; componentType: ComponentType; x: number; y: number }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'rotate'; id: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'connect'; a: TerminalRef; b: TerminalRef }
  | { type: 'deleteSelection' }
  | { type: 'select'; selection: Selection }
  | { type: 'load'; schematic: Schematic }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 100;

export const initEditor = (schematic: Schematic): EditorState => ({ schematic, selection: null, past: [], future: [] });

function nextId(prefix: string, used: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of used) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** Aynı önekli en küçük boş numara (K1, K2...). */
export function nextName(schematic: Schematic, type: ComponentType): string {
  const prefix = CATALOG[type].prefix;
  const taken = new Set(schematic.components.map((c) => c.name));
  for (let i = 1; ; i++) if (!taken.has(`${prefix}${i}`)) return `${prefix}${i}`;
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

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const s = state.schematic;
  switch (action.type) {
    case 'add': {
      const id = nextId('c', s.components.map((c) => c.id));
      const component: ComponentInstance = {
        id,
        type: action.componentType,
        name: nextName(s, action.componentType),
        x: action.x,
        y: action.y,
        rotation: 0,
      };
      return commit(state, { ...s, components: [...s.components, component] }, { kind: 'component', id });
    }
    case 'move': {
      const c = s.components.find((c) => c.id === action.id);
      if (!c || (c.x === action.x && c.y === action.y)) return state;
      return commit(state, updateComponent(s, action.id, (c) => ({ ...c, x: action.x, y: action.y })));
    }
    case 'rotate':
      if (!s.components.some((c) => c.id === action.id)) return state;
      return commit(
        state,
        updateComponent(s, action.id, (c) => ({ ...c, rotation: ((c.rotation + 90) % 360) as Rotation })),
      );
    case 'rename': {
      const name = action.name.trim();
      const c = s.components.find((c) => c.id === action.id);
      if (!c || !name || c.name === name) return state;
      return commit(state, updateComponent(s, action.id, (c) => ({ ...c, name })));
    }
    case 'connect': {
      const { a, b } = action;
      if (sameTerminal(a, b)) return state;
      const exists = s.wires.some(
        (w) => (sameTerminal(w.a, a) && sameTerminal(w.b, b)) || (sameTerminal(w.a, b) && sameTerminal(w.b, a)),
      );
      if (exists) return state;
      const id = nextId('w', s.wires.map((w) => w.id));
      return commit(state, { ...s, wires: [...s.wires, { id, a, b }] }, { kind: 'wire', id });
    }
    case 'deleteSelection': {
      const sel = state.selection;
      if (!sel) return state;
      if (sel.kind === 'wire') {
        return commit(state, { ...s, wires: s.wires.filter((w) => w.id !== sel.id) }, null);
      }
      return commit(
        state,
        {
          ...s,
          components: s.components.filter((c) => c.id !== sel.id),
          wires: s.wires.filter((w) => w.a.component !== sel.id && w.b.component !== sel.id),
        },
        null,
      );
    }
    case 'select':
      return { ...state, selection: action.selection };
    case 'load':
      return commit(state, action.schematic, null);
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { schematic: prev, selection: null, past: state.past.slice(0, -1), future: [s, ...state.future] };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { schematic: next, selection: null, past: [...state.past, s], future: state.future.slice(1) };
    }
  }
}
