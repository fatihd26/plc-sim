// v0.3 editör özellikleri: çoklu seçim/pano, bağlantı noktası, sayfalar, kullanıcı bileşeni,
// engelden kaçan yönlendirme ve elle kablo şekillendirme.

import { describe, expect, it } from 'vitest';
import type { CustomDef } from '../../sim/catalog';
import { startStopSchematic } from '../../sim/examples';
import { emptySchematic, pageOf, validateSchematic } from '../../sim/schematic';
import { Simulation } from '../../sim/simulation';
import { copySelection, editorReducer, initEditor, type EditorAction, type EditorState } from './document';
import { bounds } from './geometry';
import { boxSelect, pageContent, routePage, xrefTargets } from './layout';
import { dragSegment, manualRoute, routeAll, type Endpoint } from './routing';

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
type Pt = { x: number; y: number };

/** Yolun kapladığı ızgara hücreleri, doğrultusuyla ("x,y,h"). */
function cells(pts: Pt[]): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 10;
    for (let k = 0; k < n; k++) {
      set.add(`${a.x + ((b.x - a.x) * k) / n},${a.y + ((b.y - a.y) * k) / n},${a.x === b.x ? 'v' : 'h'}`);
    }
  }
  return set;
}

describe('çoklu seçim ve pano', () => {
  it('grup taşıma: iki ucu taşınan kablonun elle verilen noktaları da kayar', () => {
    let s = initEditor(startStopSchematic());
    const w = s.schematic.wires.find((w) => w.a.component === 'S1' && w.b.component === 'S2')!;
    s = run(s, { type: 'setWirePoints', id: w.id, points: [{ x: 420, y: 130 }] });
    s = run(s, { type: 'moveMany', ids: ['S1', 'S2'], dx: 20, dy: 10 });
    const by = (id: string) => s.schematic.components.find((c) => c.id === id)!;
    expect(by('S1')).toMatchObject({ x: 400, y: 150 });
    expect(by('S2')).toMatchObject({ x: 480, y: 150 });
    expect(by('K1')).toMatchObject({ x: 40, y: 160 });
    expect(s.schematic.wires.find((x) => x.id === w.id)!.points).toEqual([{ x: 440, y: 140 }]);
  });

  it('çoklu silme: seçili bileşenler ve kablolar birlikte silinir', () => {
    let s = initEditor(startStopSchematic());
    const wire = s.schematic.wires.find((w) => w.a.component === 'X1')!.id;
    s = run(s, { type: 'select', selection: { components: ['S1', 'S2'], wires: [wire] } }, { type: 'deleteSelection' });
    const ids = s.schematic.components.map((c) => c.id);
    expect(ids).not.toContain('S1');
    expect(ids).not.toContain('S2');
    expect(s.schematic.wires.some((w) => w.id === wire)).toBe(false);
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('kopyala/yapıştır: yeni kimlik ve ad, iç kablolar korunur, dış kablolar alınmaz', () => {
    let s = initEditor(startStopSchematic());
    const clip = copySelection(s.schematic, { components: ['S1', 'S2'], wires: [] });
    expect(clip.wires).toHaveLength(1); // yalnız S1–S2 arası
    s = run(s, { type: 'paste', clip, dx: 200, dy: 0, page: 'p1' });
    const added = s.schematic.components.slice(-2);
    expect(added.map((c) => c.name)).toEqual(['S3', 'S4']);
    expect(added[0]).toMatchObject({ x: 580, y: 140, type: 'buttonNO' });
    const ids = new Set(added.map((c) => c.id));
    expect(s.schematic.wires.filter((w) => ids.has(w.a.component) || ids.has(w.b.component))).toHaveLength(1);
    expect(s.selection.components).toEqual(added.map((c) => c.id));
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('kutu ile seçim: pencere tamamen içindekileri, sağdan sola kutu değenleri seçer', () => {
    const sch = startStopSchematic();
    const content = pageContent(sch, 'p1');
    const paths = routePage(content);
    const b = bounds(sch.components.find((c) => c.id === 'S1')!);
    const win = boxSelect(content, paths, { x0: b.x - 2, y0: b.y - 2, x1: b.x + b.w + 2, y1: b.y + b.h + 2 });
    expect(win.components).toEqual(['S1']);
    expect(win.wires).toEqual([]);
    const cross = boxSelect(content, paths, { x0: b.x + b.w + 2, y0: b.y - 2, x1: b.x - 2, y1: b.y + b.h + 2 });
    expect(cross.components).toContain('S1');
    expect(cross.wires.length).toBeGreaterThan(0);
  });
});

describe('bağlantı noktası', () => {
  const branch = () => {
    let s = initEditor(startStopSchematic());
    const w = s.schematic.wires.find((w) => w.a.component === 'G1' && w.a.terminal === 'M')!;
    s = run(s, { type: 'add', componentType: 'lamp', x: 600, y: 40, page: 'p1' });
    const lamp = s.schematic.components.at(-1)!;
    const before = s.schematic.wires.length;
    s = run(s, { type: 'connectToWire', from: { component: lamp.id, terminal: 'X2' }, wire: w.id, x: 400, y: 200 });
    return { s, w, lamp, before };
  };

  it('kablonun ortasına bağlanınca kablo bölünür ve uçlar aynı nete girer', () => {
    const { s, w, lamp, before } = branch();
    const j = s.schematic.components.find((c) => c.type === 'junction')!;
    expect(j).toMatchObject({ x: 390, y: 190 });
    expect(s.schematic.wires).toHaveLength(before + 2);
    expect(s.schematic.wires.some((x) => x.id === w.id)).toBe(false);
    expect(validateSchematic(s.schematic)).toEqual([]);
    expect(new Simulation(s.schematic).snapshot().potentials[`${lamp.id}:X2`]).toBe('M0');
  });

  it('bağlantı noktasının kabloları silinince bağlantı noktası da silinir', () => {
    let { s } = branch();
    const j = s.schematic.components.find((c) => c.type === 'junction')!;
    const touching = s.schematic.wires.filter((x) => x.a.component === j.id || x.b.component === j.id).map((x) => x.id);
    s = run(s, { type: 'select', selection: { components: [], wires: touching } }, { type: 'deleteSelection' });
    expect(s.schematic.components.some((c) => c.type === 'junction')).toBe(false);
  });
});

describe('sayfalar', () => {
  it('sayfa ekle/adlandır; eleman sayfasında kalır; sayfa silinince elemanları da gider', () => {
    let s = initEditor(startStopSchematic());
    s = run(
      s,
      { type: 'addPage', id: 'p2', title: 'Sayfa 2' },
      { type: 'renamePage', id: 'p2', title: 'Sinyal' },
      { type: 'add', componentType: 'lamp', x: 0, y: 0, page: 'p2' },
    );
    const lamp = s.schematic.components.at(-1)!;
    expect(pageOf(s.schematic, lamp)).toBe('p2');
    expect(s.schematic.pages!.map((p) => p.title)).toEqual(['Güç ve kumanda devresi', 'Sinyal']);
    expect(pageContent(s.schematic, 'p1').components.some((c) => c.id === lamp.id)).toBe(false);
    s = run(s, { type: 'deletePage', id: 'p2' });
    expect(s.schematic.components.some((c) => c.id === lamp.id)).toBe(false);
    expect(run(s, { type: 'deletePage', id: 'p1' }).schematic).toBe(s.schematic); // son sayfa silinemez
  });

  it('aynı adlı sayfa geçişleri sayfalar arasında elektriksel bağlantı kurar', () => {
    let s = initEditor(startStopSchematic());
    s = run(
      s,
      { type: 'addPage', id: 'p2', title: 'Sinyal' },
      { type: 'add', componentType: 'xref', x: 600, y: 0, page: 'p1' },
      { type: 'add', componentType: 'xref', x: 0, y: 0, page: 'p2' },
      { type: 'add', componentType: 'lamp', x: 100, y: 0, page: 'p2' },
    );
    const [x1, x2, lamp] = s.schematic.components.slice(-3).map((c) => ({ id: c.id }));
    s = run(
      s,
      { type: 'rename', id: x1!.id, name: 'L+' },
      { type: 'rename', id: x2!.id, name: 'L+' },
      { type: 'connect', a: { component: 'G1', terminal: 'L+' }, b: { component: x1!.id, terminal: '1' } },
      { type: 'connect', a: { component: x2!.id, terminal: '1' }, b: { component: lamp!.id, terminal: 'X1' } },
      { type: 'connect', a: { component: lamp!.id, terminal: 'X2' }, b: { component: 'G1', terminal: 'M' } },
    );
    const x1Now = s.schematic.components.find((c) => c.id === x1!.id)!;
    expect(xrefTargets(s.schematic, x1Now)).toEqual([{ page: 'p2', component: x2!.id, label: '/2' }]);
    const sim = new Simulation(s.schematic);
    sim.run(2);
    const st = sim.snapshot().components[lamp!.id];
    expect(st?.type === 'lamp' && st.lit).toBe(true);
  });
});

describe('kullanıcı tanımlı bileşen', () => {
  const relay: CustomDef = {
    id: 'u1',
    title: 'Röle',
    prefix: 'KA',
    voltage: '24DC',
    poles: [
      { kind: 'coil', top: 'A1', bottom: 'A2' },
      { kind: 'NO', top: '13', bottom: '14' },
    ],
  };

  it('tanım güncellenince örnekler güncellenir, kaybolan terminallerin kabloları silinir', () => {
    let s = run(
      initEditor(emptySchematic()),
      { type: 'defineCustom', def: relay },
      { type: 'add', componentType: 'custom', x: 0, y: 0, page: 'p1', custom: relay },
      { type: 'add', componentType: 'psu24', x: 0, y: -100, page: 'p1' },
    );
    const k = s.schematic.components[0]!;
    const g = s.schematic.components[1]!;
    expect(k.name).toBe('KA1');
    s = run(
      s,
      { type: 'connect', a: { component: g.id, terminal: 'L+' }, b: { component: k.id, terminal: '13' } },
      { type: 'connect', a: { component: g.id, terminal: 'M' }, b: { component: k.id, terminal: 'A2' } },
    );
    const changed: CustomDef = { ...relay, poles: [relay.poles[0]!, { kind: 'NC', top: '21', bottom: '22' }] };
    s = run(s, { type: 'defineCustom', def: changed });
    expect(s.schematic.components[0]!.custom!.poles[1]!.kind).toBe('NC');
    expect(s.schematic.wires).toHaveLength(1); // 13 terminali artık yok
    expect(validateSchematic(s.schematic)).toEqual([]);
  });

  it('kütüphaneden silinen tanımın şemadaki örnekleri çalışmaya devam eder', () => {
    let s = run(
      initEditor(emptySchematic()),
      { type: 'defineCustom', def: relay },
      { type: 'add', componentType: 'custom', x: 0, y: 0, page: 'p1', custom: relay },
      { type: 'deleteCustom', id: 'u1' },
    );
    expect(s.schematic.library).toEqual([]);
    expect(validateSchematic(s.schematic)).toEqual([]);
    s = run(s, { type: 'undo' });
    expect(s.schematic.library).toHaveLength(1);
  });
});

describe('engelden kaçan yönlendirme', () => {
  const ep = (x: number, y: number, dir: Endpoint['dir']): Endpoint => ({ x, y, dir });

  it('aradaki elemanın gövdesinden geçmez', () => {
    const obstacle = { x: 60, y: 60, w: 80, h: 80 };
    const path = routeAll([{ id: 'w', a: ep(100, 0, 'down'), b: ep(100, 200, 'up'), net: 0 }], [obstacle], []).get('w')!;
    expect(path[0]).toEqual({ x: 100, y: 0 });
    expect(path.at(-1)).toEqual({ x: 100, y: 200 });
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      const inside =
        Math.max(a.x, b.x) > obstacle.x &&
        Math.min(a.x, b.x) < obstacle.x + obstacle.w &&
        Math.max(a.y, b.y) > obstacle.y &&
        Math.min(a.y, b.y) < obstacle.y + obstacle.h;
      expect(inside).toBe(false);
    }
  });

  it('farklı netlerin kabloları aynı doğrultuda üst üste binmez', () => {
    const out = routeAll(
      [
        { id: 'a', a: ep(0, 0, 'down'), b: ep(200, 100, 'up'), net: 0 },
        { id: 'b', a: ep(20, 0, 'down'), b: ep(220, 100, 'up'), net: 1 },
      ],
      [],
      [],
    );
    const ca = cells(out.get('a')!);
    expect([...cells(out.get('b')!)].filter((c) => ca.has(c))).toEqual([]);
  });

  it('örnek şemada farklı netlerin kabloları üst üste binmez', () => {
    const sch = startStopSchematic();
    const content = pageContent(sch, 'p1');
    const paths = routePage(content);
    expect(paths.size).toBe(content.wires.length);
    // Kablo → net: aynı nete bağlı kablolar hattı paylaşabilir
    const netOf = new Map<string, string>();
    const sim = new Simulation(sch);
    sim.run(1);
    const pot = sim.snapshot().potentials;
    for (const w of content.wires) netOf.set(w.id, `${pot[`${w.a.component}:${w.a.terminal}`]}`);
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const w of content.wires) {
      for (const c of cells(paths.get(w.id)!)) {
        const other = owner.get(c);
        // Potansiyelsiz (null) netler ayırt edilemez; yalnız farklı ve bilinen potansiyeller denetlenir
        if (other && netOf.get(other) !== netOf.get(w.id) && netOf.get(w.id) !== 'null' && netOf.get(other) !== 'null') {
          clashes.push(`${other}/${w.id}@${c}`);
        }
        owner.set(c, w.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('parça sürükleme ara noktaları üretir; elle güzergâh bu noktalardan geçer', () => {
    const a = ep(0, 0, 'down');
    const b = ep(0, 100, 'up');
    const full = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: 90 },
      { x: 0, y: 100 },
    ];
    const points = dragSegment(full, 1, { x: 43, y: 50 });
    expect(manualRoute(a, b, points)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 90 },
      { x: 0, y: 90 },
      { x: 0, y: 100 },
    ]);
  });
});
