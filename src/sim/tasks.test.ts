import { describe, expect, it } from 'vitest';
import { fanSchematic } from './examples';
import { runScenario } from './scenario';
import { validateSchematic } from './schematic';
import { TASKS, taskSchematic } from './tasks';

describe('görev senaryoları', () => {
  it.each(TASKS.map((t) => [t.id, t] as const))('%s: çözüm geçer, boş program kalır', { timeout: 60_000 }, (_, t) => {
    const solved = runScenario(t.solution(), t.task.scenario);
    expect(solved.error).toBeUndefined();
    expect(solved.steps.filter((s) => s.status === 'fail')).toEqual([]);
    expect(solved.ok).toBe(true);
    expect(solved.total).toBeGreaterThan(0);

    const empty = taskSchematic(t);
    expect(validateSchematic(empty)).toEqual([]);
    expect(empty.task?.scenario).toBe(t.task.scenario);
    const r = runScenario(empty, t.task.scenario);
    expect(r.ok).toBe(false);
    expect(r.passed).toBeLessThan(r.total);
  });

  it('ayrıştırma hataları satır numarasıyla bildirilir', () => {
    expect(runScenario(fanSchematic(), 'tıkla S1\nzıpla S1').error).toMatch(/Satır 2: bilinmeyen komut/);
    expect(runScenario(fanSchematic(), 'bas S9').error).toMatch(/S9/);
    expect(runScenario(fanSchematic(), 'bekle 2 saat').error).toMatch(/koşul|süre|sinyal/);
  });

  it('PLC adresleri ve süre birimleri', () => {
    const r = runScenario(
      fanSchematic(),
      ['# yorum', 'kontrol %Q0.0 = 0', 'tıkla S1 200 ms', 'bekle %Q0.0 en fazla 0,5 s', 'kontrol A1.%Q0.0 = 1 ve %I0.1', 'bekle 1,5 s'].join('\n'),
    );
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.steps.at(-1)!.timeMs).toBeGreaterThan(1700);
  });

  it('başarısız denetimden sonra kalan satırlar atlanır', () => {
    const r = runScenario(fanSchematic(), 'kontrol E1.calisiyor\ntıkla S1\nkontrol E1.calisiyor');
    expect(r.steps.map((s) => s.status)).toEqual(['fail', 'skip', 'skip']);
    expect(r.passed).toBe(0);
    expect(r.total).toBe(2);
  });
});
