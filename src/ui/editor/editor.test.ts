import { describe, expect, it } from 'vitest';
import { startStopSchematic } from '../../sim/examples';
import { emptySchematic, validateSchematic } from '../../sim/schematic';
import { editorReducer, initEditor, type EditorAction, type EditorState } from './document';
import { bounds, geometryMismatches, GEOMETRY, worldTerminal } from './geometry';
import { route, simplify } from './routing';

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);

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
      { type: 'add', componentType: 'contactor', x: 0, y: 0 },
      { type: 'add', componentType: 'contactor', x: 200, y: 0 },
      { type: 'add', componentType: 'buttonNO', x: 0, y: 200 },
      { type: 'add', componentType: 'buttonNC', x: 0, y: 200 },
    );
    expect(s.schematic.components.map((c) => c.name)).toEqual(['K1', 'K2', 'S1', 'S2']);
    expect(new Set(s.schematic.components.map((c) => c.id)).size).toBe(4);
    expect(s.selection).toEqual({ kind: 'component', id: s.schematic.components[3]!.id });
  });

  it('silinen addan sonra boş numara yeniden kullanılır', () => {
    let s = run(empty, { type: 'add', componentType: 'motor3', x: 0, y: 0 }, { type: 'add', componentType: 'motor3', x: 0, y: 0 });
    s = run(s, { type: 'select', selection: { kind: 'component', id: s.schematic.components[0]!.id } }, { type: 'deleteSelection' });
    s = run(s, { type: 'add', componentType: 'motor3', x: 0, y: 0 });
    expect(s.schematic.components.map((c) => c.name).sort()).toEqual(['M1', 'M2']);
  });

  it('kablo: aynı terminal ve tekrarlanan bağlantı reddedilir', () => {
    let s = run(empty, { type: 'add', componentType: 'buttonNO', x: 0, y: 0 }, { type: 'add', componentType: 'buttonNC', x: 100, y: 0 });
    const [a, b] = s.schematic.components;
    const ta = { component: a!.id, terminal: '14' };
    const tb = { component: b!.id, terminal: '11' };
    s = run(s, { type: 'connect', a: ta, b: ta });
    expect(s.schematic.wires).toHaveLength(0);
    s = run(s, { type: 'connect', a: ta, b: tb }, { type: 'connect', a: tb, b: ta });
    expect(s.schematic.wires).toHaveLength(1);
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('bileşen silinince bağlı kabloları da silinir', () => {
    let s = initEditor(startStopSchematic());
    const before = s.schematic.wires.length;
    s = run(s, { type: 'select', selection: { kind: 'component', id: 'S1' } }, { type: 'deleteSelection' });
    expect(s.schematic.components.some((c) => c.id === 'S1')).toBe(false);
    expect(s.schematic.wires.length).toBe(before - 3);
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('geri al / yinele', () => {
    let s = run(empty, { type: 'add', componentType: 'psu24', x: 0, y: 0 });
    const id = s.schematic.components[0]!.id;
    s = run(s, { type: 'move', id, x: 50, y: 60 }, { type: 'rotate', id });
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
    let s = run(empty, { type: 'add', componentType: 'psu24', x: 0, y: 0 });
    const id = s.schematic.components[0]!.id;
    const pastLen = s.past.length;
    s = run(s, { type: 'move', id, x: 0, y: 0 }, { type: 'rename', id, name: '  ' }, { type: 'select', selection: null });
    expect(s.past.length).toBe(pastLen);
  });
});
