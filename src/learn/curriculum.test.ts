import { describe, expect, it } from 'vitest';
import { coil, nc, net, no, program } from '../sim/build';
import { runScenario } from '../sim/scenario';
import { validateSchematic, type Schematic } from '../sim/schematic';
import { Simulation } from '../sim/simulation';
import { TASKS } from '../sim/tasks';
import { LEVELS, locate, playable, type Lesson, type StepContext } from './curriculum';
import { emptyProgress, levelUnlocked, nextItem, parseProgress, serializeProgress } from './progress';

const lesson = (id: string) => locate(id)!.item as Lesson;
const stepByTodo = (l: Lesson, todo: string) => l.steps.find((s) => s.todo === todo)!;

/** Şemayı simülasyonda `actions` ile koşturup adımın `done` denetimini canlı snapshot'ta sorar. */
function doneAfter(l: Lesson, todo: string, s: Schematic, actions: (sim: Simulation) => void): boolean {
  const sim = new Simulation(s);
  actions(sim);
  const ctx: StepContext = { schematic: s, snapshot: sim.snapshot(), mode: 'sim', running: true, plcOpen: true };
  return stepByTodo(l, todo).done!(ctx);
}
const click = (sim: Simulation, id: string) => {
  sim.enqueue({ type: 'button', component: id, pressed: true });
  sim.run(100);
  sim.enqueue({ type: 'button', component: id, pressed: false });
  sim.run(50);
};

describe('eğitim yolu', () => {
  it('5 seviye, benzersiz kimlikler, her seviyenin tek çıkış görevi var', () => {
    expect(LEVELS.map((l) => l.title)).toEqual(['Başlangıç', 'Temel', 'Orta', 'İleri', 'Saha Senaryoları']);
    const ids = LEVELS.flatMap((l) => l.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LEVELS) {
      const exits = l.items.filter((i) => 'exit' in i && i.exit);
      expect(exits, l.title).toHaveLength(1);
      expect(l.items.at(-1), l.title).toBe(exits[0]);
    }
  });

  it('görevler tasks.ts\'te var, derslerin şeması geçerli', () => {
    for (const i of playable()) {
      if (i.kind === 'task') expect(TASKS.some((t) => t.id === i.taskId), i.id).toBe(true);
      else if (i.build) expect(validateSchematic(i.build()), i.id).toEqual([]);
      if (i.kind === 'lesson') expect(i.steps.length, i.id).toBeGreaterThan(2);
    }
  });

  it('Başlangıç dersleri: denetimler canlı simülasyonda sağlanır', () => {
    const contacts = lesson('b-kontak');
    const s = contacts.build!();
    expect(doneAfter(contacts, 'P2 yanık, P1 sönük', s, (sim) => sim.run(50))).toBe(true);
    expect(doneAfter(contacts, 'S1 basılıyken P1 yansın', s, (sim) => sim.run(50))).toBe(false);
    expect(
      doneAfter(contacts, 'S1 basılıyken P1 yansın', s, (sim) => {
        sim.enqueue({ type: 'button', component: 'S1', pressed: true });
        sim.run(50);
      }),
    ).toBe(true);

    // Röle dersi: öğrenci 23-24 mühür kablolarını ekleyince S1 bırakılınca lamba yanık kalır.
    const relay = lesson('b-role');
    const r = relay.build!();
    expect(doneAfter(relay, 'S1 bırakıldığında P1 yanık kalsın', r, (sim) => click(sim, 'S1'))).toBe(false);
    let w = 100;
    const wire = (a: string, b: string) => {
      const [ac, at] = a.split(':') as [string, string];
      const [bc, bt] = b.split(':') as [string, string];
      r.wires.push({ id: `w${++w}`, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt } });
    };
    wire('G1:L+', 'K1:23');
    wire('K1:24', 'K1:A1');
    expect(doneAfter(relay, 'S1 bırakıldığında P1 yanık kalsın', r, (sim) => click(sim, 'S1'))).toBe(true);
  });

  it('koruma dersi: yük %300 olunca termik atar ve K1 bırakır', () => {
    const l = lesson('b-koruma');
    const s = l.build!();
    const ctx = (sch: Schematic): StepContext => ({ schematic: sch, snapshot: null, mode: 'edit', running: false, plcOpen: false });
    expect(stepByTodo(l, 'M1 yükü en az %200').done!(ctx(s))).toBe(false);
    s.components.find((c) => c.name === 'M1')!.params = { loadPct: 300 };
    expect(stepByTodo(l, 'M1 yükü en az %200').done!(ctx(s))).toBe(true);
    const r = runScenario(s, ['tıkla S1', 'kontrol M1.calisiyor', 'bekle F2.atti ve değil K1.kontak en fazla 30 s'].join('\n'));
    expect(r.steps.filter((x) => x.status === 'fail')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('Temel dersleri: örnek programlar ders adımlarını sağlar', () => {
    const plc = lesson('t-plc');
    expect(doneAfter(plc, 'M1 çalışsın', plc.build!(), (sim) => click(sim, 'S1'))).toBe(true);

    const ladder = lesson('t-ladder');
    expect(doneAfter(ladder, 'S1 bırakılınca fan çalışsın', ladder.build!(), (sim) => click(sim, 'S1'))).toBe(true);

    // Set/Reset dersi boş programla başlar; öğrencinin yazacağı program adımı sağlar.
    const sr = lesson('t-setreset');
    const s = sr.build!();
    const a1 = s.components.find((c) => c.type === 'plc')!;
    expect(a1.program?.networks).toEqual([]);
    expect(doneAfter(sr, 'S1 bırakılınca fan çalışsın', s, (sim) => click(sim, 'S1'))).toBe(false);
    a1.program = program(net('N1', 'Set', no('%I0.0'), coil('%Q0.0', 'set')), net('N2', 'Reset', nc('%I0.1'), coil('%Q0.0', 'reset')));
    expect(doneAfter(sr, 'S1 bırakılınca fan çalışsın', s, (sim) => click(sim, 'S1'))).toBe(true);
    expect(
      doneAfter(sr, 'Fan dursun', s, (sim) => {
        click(sim, 'S1');
        click(sim, 'S2');
      }),
    ).toBe(true);

    const counter = lesson('t-counter');
    const t = counter.build!();
    expect(
      doneAfter(counter, 'P1 yansın', t, (sim) => {
        for (let i = 0; i < 3; i++) click(sim, 'S1');
        sim.run(2500);
      }),
    ).toBe(true);
    const ctx: StepContext = { schematic: t, snapshot: null, mode: 'edit', running: false, plcOpen: false };
    expect(stepByTodo(counter, 'C0 ön ayarı 5').done!(ctx)).toBe(false);
    t.components.find((c) => c.type === 'plc')!.program!.networks.find((n) => n.coil.address === 'C0' && n.coil.type === 'CTU')!.coil.preset = 5;
    expect(stepByTodo(counter, 'C0 ön ayarı 5').done!(ctx)).toBe(true);

    const timer = lesson('t-timer');
    // Flaşör: P2 ilk kez T1 (500 ms) dolunca yanar.
    expect(
      doneAfter(timer, 'P2 yansın', timer.build!(), (sim) => {
        click(sim, 'S1');
        sim.run(500);
      }),
    ).toBe(true);
  });
});

describe('ilerleme', () => {
  it('seviye, önceki seviyenin çıkış görevi geçilince açılır', () => {
    const p = emptyProgress();
    expect(levelUnlocked(p, 0)).toBe(true);
    expect(levelUnlocked(p, 1)).toBe(false);
    p.done['b-g-ileri-geri'] = '2026-10-16T00:00:00Z';
    expect(levelUnlocked(p, 1)).toBe(true);
    expect(levelUnlocked(p, 2)).toBe(false);
    p.done['t-g-yildiz'] = 'x';
    p.done['o-g-asansor'] = 'x';
    // İleri seviyenin çıkış görevi henüz yazılmadı: Saha seviyesini engellemez.
    expect(levelUnlocked(p, 4)).toBe(true);
  });

  it('sıradaki öğe: açık seviyelerde ilk tamamlanmamış', () => {
    const p = emptyProgress();
    expect(nextItem(p)?.id).toBe('b-devre');
    p.done['b-devre'] = 'x';
    expect(nextItem(p)?.id).toBe('b-kontak');
    expect(nextItem(p, 'b-role')?.id).toBe('b-g-muhur');
    // Başlangıç bitmeden Temel'e geçilmez: son öğeden sonra baştaki eksiğe dönülür.
    expect(nextItem(p, 'b-g-ileri-geri')?.id).toBe('b-kontak');
  });

  it('dosya: kaydet / yükle ve yanlış dosya', () => {
    const p = { done: { 'b-devre': '2026-10-16T10:00:00Z' }, attempts: { 'b-g-lamba': 2 }, current: { item: 'b-kontak', step: 3 } };
    const s = lesson('b-devre').build!();
    const back = parseProgress(serializeProgress(p, s));
    expect(back.progress).toEqual(p);
    expect(back.schematic).toEqual(s);
    expect(() => parseProgress('{"version":2}')).toThrow(/ilerleme dosyası değil/);
    expect(() => parseProgress('bozuk')).toThrow(/JSON/);
  });
});
