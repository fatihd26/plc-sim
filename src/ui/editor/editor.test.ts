import { describe, expect, it } from 'vitest';
import { startStopSchematic } from '../../sim/examples';
import { emptySchematic, validateSchematic } from '../../sim/schematic';
import { EMPTY_SELECTION, editorReducer, initEditor, selectComponent, type EditorAction, type EditorState } from './document';
import { bounds, geometryMismatches, GEOMETRY, worldTerminal } from './geometry';
import { route, simplify } from './routing';

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const add = (componentType: Extract<EditorAction, { type: 'add' }>['componentType'], x: number, y: number): EditorAction => ({
  type: 'add',
  componentType,
  x,
  y,
  page: 'p1',
});

describe('geometri', () => {
  it('her katalog tipinin tüm terminalleri çizimde tanımlı', () => {
    expect(geometryMismatches()).toEqual([]);
  });

  it('terminaller ızgara üzerinde', () => {
    for (const g of Object.values(GEOMETRY)) {
      expect(g.w % 20).toBe(0);
      expect(g.h % 20).toBe(0);
      for (const t of g.terminals) {
        expect(t.x % 10).toBe(0);
        expect(t.y % 10).toBe(0);
      }
    }
  });

  it('90° döndürmede terminal konumu ve yönü döner', () => {
    const inst = { id: 'b', type: 'buttonNO' as const, name: 'S1', x: 100, y: 100, rotation: 0 as const };
    expect(worldTerminal(inst, '13')).toMatchObject({ x: 120, y: 100, dir: 'up' });
    const r = { ...inst, rotation: 90 as const };
    // Merkez (120,130); üstteki terminal sağa döner
    expect(worldTerminal(r, '13')).toMatchObject({ x: 150, y: 130, dir: 'right' });
    expect(worldTerminal(r, '14')).toMatchObject({ x: 90, y: 130, dir: 'left' });
    expect(bounds(r)).toEqual({ x: 90, y: 110, w: 60, h: 40 });
  });
});

describe('kablo yönlendirme', () => {
  it('yalnız yatay/dikey parçalardan oluşur', () => {
    const pts = route({ x: 0, y: 0, dir: 'down' }, { x: 70, y: 100, dir: 'up' });
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 70, y: 100 });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('hizalı terminaller arasında düz çizgi', () => {
    expect(route({ x: 20, y: 40, dir: 'down' }, { x: 20, y: 160, dir: 'up' })).toEqual([
      { x: 20, y: 40 },
      { x: 20, y: 160 },
    ]);
  });

  it('simplify tekrar ve doğrusal ara noktaları siler', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 0, y: 10 },
        { x: 5, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 5, y: 10 },
    ]);
  });
});

describe('editör dokümanı', () => {
  const empty = initEditor(emptySchematic());

  it('eklenen bileşenler benzersiz kimlik ve önekli ad alır', () => {
    const s = run(
      empty,
      add('contactor', 0, 0),
      add('contactor', 200, 0),
      add('buttonNO', 0, 200),
      add('buttonNC', 0, 200),
    );
    expect(s.schematic.components.map((c) => c.name)).toEqual(['K1', 'K2', 'S1', 'S2']);
    expect(new Set(s.schematic.components.map((c) => c.id)).size).toBe(4);
    expect(s.selection).toEqual(selectComponent(s.schematic.components[3]!.id));
  });

  it('silinen addan sonra boş numara yeniden kullanılır', () => {
    let s = run(empty, add('motor3', 0, 0), add('motor3', 0, 0));
    s = run(s, { type: 'select', selection: selectComponent(s.schematic.components[0]!.id) }, { type: 'deleteSelection' });
    s = run(s, add('motor3', 0, 0));
    expect(s.schematic.components.map((c) => c.name).sort()).toEqual(['M1', 'M2']);
  });

  it('kablo: aynı terminal ve tekrarlanan bağlantı reddedilir', () => {
    let s = run(empty, add('buttonNO', 0, 0), add('buttonNC', 100, 0));
    const [a, b] = s.schematic.components;
    const ta = { component: a!.id, terminal: '14' };
    const tb = { component: b!.id, terminal: '11' };
    s = run(s, { type: 'connect', a: ta, b: ta });
    expect(s.schematic.wires).toHaveLength(0);
    s = run(s, { type: 'connect', a: ta, b: tb }, { type: 'connect', a: tb, b: ta });
    expect(s.schematic.wires).toHaveLength(1);
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('kablo: çizerken bırakılan köşe noktaları kaydedilir', () => {
    let s = run(empty, add('buttonNO', 0, 0), add('buttonNC', 200, 200));
    const [a, b] = s.schematic.components;
    const ta = { component: a!.id, terminal: '14' };
    const tb = { component: b!.id, terminal: '11' };
    const points = [{ x: 100, y: 60 }, { x: 150, y: 60 }];
    s = run(s, { type: 'connect', a: ta, b: tb, points });
    expect(s.schematic.wires[0]!.points).toEqual(points);
    s = run(s, { type: 'connect', a: tb, b: { component: a!.id, terminal: '13' }, points: [] });
    expect(s.schematic.wires[1]!.points).toBeUndefined();
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('bileşen silinince bağlı kabloları da silinir', () => {
    let s = initEditor(startStopSchematic());
    const before = s.schematic.wires.length;
    s = run(s, { type: 'select', selection: selectComponent('S1') }, { type: 'deleteSelection' });
    expect(s.schematic.components.some((c) => c.id === 'S1')).toBe(false);
    expect(s.schematic.wires.length).toBe(before - 3);
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('geri al / yinele', () => {
    let s = run(empty, add('psu24', 0, 0));
    const id = s.schematic.components[0]!.id;
    s = run(s, { type: 'moveMany', ids: [id], dx: 50, dy: 60 }, { type: 'rotate', ids: [id] });
    expect(s.schematic.components[0]).toMatchObject({ x: 50, y: 60, rotation: 90 });
    s = run(s, { type: 'undo' });
    expect(s.schematic.components[0]).toMatchObject({ x: 50, y: 60, rotation: 0 });
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(s.schematic.components).toHaveLength(0);
    s = run(s, { type: 'redo' });
    expect(s.schematic.components).toHaveLength(1);
    // Yeni değişiklik yinele geçmişini temizler
    s = run(s, { type: 'rename', id, name: 'G9' });
    expect(s.future).toEqual([]);
  });

  it('değişmeyen işlemler geçmişe yazılmaz', () => {
    let s = run(empty, add('psu24', 0, 0));
    const id = s.schematic.components[0]!.id;
    const pastLen = s.past.length;
    s = run(
      s,
      { type: 'moveMany', ids: [id], dx: 0, dy: 0 },
      { type: 'rename', id, name: '  ' },
      { type: 'select', selection: EMPTY_SELECTION },
      { type: 'setParam', id, key: 'yok', value: 1 },
    );
    expect(s.past.length).toBe(pastLen);
  });
});
