// Görev senaryoları: öğretmenin yazdığı satır tabanlı test dili ve çalıştırıcısı.
// Senaryo, şemadan sıfırdan kurulan bir simülasyonda (gerçek zamandan bağımsız, hızlı) koşar ve
// her satırın sonucunu verir. Öğrenci "Kontrol et" ile programının görevi yerine getirip
// getirmediğini görür. Aynı dil hedefler.md'deki AI test döngüsü için de uygundur.
//
// Komutlar (satır başına bir tane; # ile başlayan satır yorumdur):
//   bas S1                     butona bas (basılı kalır)
//   bırak S1                   butonu bırak
//   tıkla S1 [süre]            bas, süre kadar bekle (varsayılan 100 ms), bırak
//   aç Q1 / kapat Q1           şalter veya sigortayı aç / kapat
//   eylem B1 toggle [değer]    bileşen eylemi (Özellikler panelindeki düğmelerle aynı)
//   arıza K1 coil / onar K1 coil
//   kopar w12 / bağla w12      kabloyu kopar / onar
//   bekle 2 s                  süre kadar ilerle (ms, s)
//   bekle <koşul> [en fazla 5 s]   koşul sağlanana kadar ilerle (yoksa hata, varsayılan 10 s)
//   kontrol <koşul> [boyunca 2 s]  koşulu denetle (boyunca: süre boyunca hep doğru olmalı)
//
// Koşul: <sinyal> [<op> <değer>] ("ve" ile birleştirilebilir); "değil <sinyal>" tersi.
//   Sinyal: Bileşen.sinyal (K1.kontak, T1.seviye, A1.%Q0.0) veya yalnız bileşen adı (ilk sinyali);
//   PLC adresi tek başına (%Q0.0) şemadaki ilk PLC'yi okur. Op: = != < <= > >=.
//   Değer: sayı, 1/0, doğru/yanlış.

import { allSignals } from './signals';
import type { Schematic } from './schematic';
import { Simulation, type SimCommand, type SimSnapshot } from './simulation';

export interface ScenarioStep {
  line: number;
  text: string;
  /** Denetim satırı mı (puanlamaya girer). */
  check: boolean;
  status: 'ok' | 'fail' | 'skip' | 'done';
  message?: string;
  /** Satırın bittiği simülasyon zamanı [ms]. */
  timeMs: number;
}

export interface ScenarioResult {
  ok: boolean;
  steps: ScenarioStep[];
  passed: number;
  total: number;
  /** Ayrıştırma veya kurulum hatası. */
  error?: string;
}

type Op = '=' | '!=' | '<' | '<=' | '>' | '>=';
type Cond = { ref: string; op: Op; value: number; negate: boolean }[];

type Cmd =
  | { kind: 'send'; commands: SimCommand[] }
  | { kind: 'click'; component: string; ms: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'waitFor'; cond: Cond; timeout: number }
  | { kind: 'check'; cond: Cond; holdMs: number };

const DEFAULT_TIMEOUT = 10_000;
const MAX_TOTAL_MS = 10 * 60_000;

/** "500", "500 ms", "2 s", "2,5 s" → ms. */
function duration(text: string): number {
  const m = /^(\d+(?:[.,]\d+)?)\s*(ms|s|sn|dk)?$/i.exec(text.trim());
  if (!m) throw new Error(`süre anlaşılamadı: "${text}" (ör. 500 ms, 2 s)`);
  const v = Number(m[1]!.replace(',', '.'));
  const unit = (m[2] ?? 'ms').toLowerCase();
  return Math.round(unit === 'ms' ? v : unit === 'dk' ? v * 60_000 : v * 1000);
}

function parseCond(text: string): Cond {
  return text.split(/\s+ve\s+/i).map((part) => {
    let t = part.trim();
    let negate = false;
    if (/^değil\s+/i.test(t)) {
      negate = true;
      t = t.replace(/^değil\s+/i, '');
    }
    const m = /^(\S+)\s*(=|==|!=|<>|<=|>=|<|>)\s*(\S+)$/.exec(t);
    if (!m) {
      if (!/^\S+$/.test(t)) throw new Error(`koşul anlaşılamadı: "${part}"`);
      return { ref: t, op: '!=' as Op, value: 0, negate };
    }
    const raw = m[3]!.toLowerCase();
    const value = raw === 'doğru' || raw === 'true' ? 1 : raw === 'yanlış' || raw === 'false' ? 0 : Number(raw.replace(',', '.'));
    if (!Number.isFinite(value)) throw new Error(`değer sayı olmalı: "${m[3]}"`);
    const op = (m[2] === '==' ? '=' : m[2] === '<>' ? '!=' : m[2]) as Op;
    return { ref: m[1]!, op, value, negate };
  });
}

function parseLine(text: string, ids: Map<string, string>): Cmd {
  const [head, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  const comp = (name: string | undefined) => {
    const id = name && ids.get(name);
    if (!id) throw new Error(`şemada "${name ?? ''}" adlı bileşen yok`);
    return id;
  };
  switch (head!.toLocaleLowerCase('tr')) {
    case 'bas':
      return { kind: 'send', commands: [{ type: 'button', component: comp(rest[0]), pressed: true }] };
    case 'bırak':
      return { kind: 'send', commands: [{ type: 'button', component: comp(rest[0]), pressed: false }] };
    case 'tıkla':
      return { kind: 'click', component: comp(rest[0]), ms: rest[1] ? duration(rest.slice(1).join(' ')) : 100 };
    case 'aç':
      return { kind: 'send', commands: [{ type: 'switch', component: comp(rest[0]), closed: false }] };
    case 'kapat':
      return { kind: 'send', commands: [{ type: 'switch', component: comp(rest[0]), closed: true }] };
    case 'eylem': {
      if (!rest[1]) throw new Error('eylem adı eksik (ör. eylem M1 addBox)');
      const value = rest[2] !== undefined ? Number(rest[2]) : undefined;
      return { kind: 'send', commands: [{ type: 'device', component: comp(rest[0]), action: rest[1], value }] };
    }
    case 'arıza':
    case 'onar':
      if (!rest[1]) throw new Error('arıza anahtarı eksik (ör. arıza K1 coil)');
      return { kind: 'send', commands: [{ type: 'fault', component: comp(rest[0]), fault: rest[1], active: head === 'arıza' }] };
    case 'kopar':
    case 'bağla':
      if (!rest[0]) throw new Error('kablo kimliği eksik (ör. kopar w12)');
      return { kind: 'send', commands: [{ type: 'wireFault', component: rest[0], broken: head === 'kopar' }] };
    case 'bekle': {
      if (/^\d/.test(arg) && !/[<>=]/.test(arg)) return { kind: 'wait', ms: duration(arg) };
      const m = /^(.*?)(?:\s+en fazla\s+(.+))?$/i.exec(arg)!;
      return { kind: 'waitFor', cond: parseCond(m[1]!), timeout: m[2] ? duration(m[2]) : DEFAULT_TIMEOUT };
    }
    case 'kontrol': {
      const m = /^(.*?)(?:\s+boyunca\s+(.+))?$/i.exec(arg)!;
      return { kind: 'check', cond: parseCond(m[1]!), holdMs: m[2] ? duration(m[2]) : 0 };
    }
    default:
      throw new Error(`bilinmeyen komut "${head}" (bas, bırak, tıkla, aç, kapat, eylem, arıza, onar, kopar, bağla, bekle, kontrol)`);
  }
}

/** Sinyal değerlerini okuyan değerlendirici; hata metni veya null (doğru). */
function evaluator(schematic: Schematic) {
  const firstPlc = schematic.components.find((c) => c.type === 'plc' || c.type === 'esp32')?.name;
  const resolve = (snap: SimSnapshot, ref: string): { value: number | null; error?: string } => {
    const all = allSignals(schematic, snap);
    let key = ref;
    if (/^%/.test(ref) || /^(HC|T|C)\d+$/i.test(ref)) {
      if (!firstPlc) return { value: null, error: 'şemada PLC yok' };
      key = `${firstPlc}.${ref.toUpperCase()}`;
    }
    let sig = all.find((s) => s.key === key);
    if (!sig && !key.includes('.')) sig = all.find((s) => s.key.startsWith(`${key}.`));
    if (!sig) {
      // Zamanlayıcı/sayıcı sıfırken listede yoktur: 0 say.
      if (/\.(T|C)\d+$/i.test(key)) return { value: 0 };
      return { value: null, error: `"${ref}" sinyali bulunamadı` };
    }
    return { value: typeof sig.value === 'boolean' ? (sig.value ? 1 : 0) : sig.value };
  };
  const test = (a: number, op: Op, b: number) =>
    op === '=' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
  return (snap: SimSnapshot, cond: Cond): { ok: boolean; detail: string; error?: string } => {
    const parts: string[] = [];
    let ok = true;
    for (const c of cond) {
      const r = resolve(snap, c.ref);
      if (r.error) return { ok: false, detail: r.error, error: r.error };
      const pass = test(r.value!, c.op, c.value) !== c.negate;
      parts.push(`${c.ref} = ${+r.value!.toFixed(3)}`);
      if (!pass) ok = false;
    }
    return { ok, detail: parts.join(', ') };
  };
}

export function runScenario(schematic: Schematic, text: string): ScenarioResult {
  const ids = new Map(schematic.components.map((c) => [c.name, c.id]));
  const lines = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t.trim() })).filter((l) => l.text && !l.text.startsWith('#'));
  const parsed: { line: number; text: string; cmd: Cmd }[] = [];
  for (const l of lines) {
    try {
      parsed.push({ ...l, cmd: parseLine(l.text, ids) });
    } catch (e) {
      return { ok: false, steps: [], passed: 0, total: 0, error: `Satır ${l.line}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  let sim: Simulation;
  try {
    sim = new Simulation(schematic);
  } catch (e) {
    return { ok: false, steps: [], passed: 0, total: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const evaluate = evaluator(schematic);
  const steps: ScenarioStep[] = [];
  let failed = false;
  // Komutların uygulanması ve sinyallerin oturması için kısa bir ilerleme
  const settle = () => sim.run(1);
  for (const p of parsed) {
    const isCheck = p.cmd.kind === 'check' || p.cmd.kind === 'waitFor';
    if (failed || sim.tick > MAX_TOTAL_MS) {
      steps.push({ line: p.line, text: p.text, check: isCheck, status: 'skip', timeMs: sim.tick });
      continue;
    }
    const c = p.cmd;
    const step: ScenarioStep = { line: p.line, text: p.text, check: isCheck, status: 'done', timeMs: 0 };
    switch (c.kind) {
      case 'send':
        c.commands.forEach((cmd) => sim.enqueue(cmd));
        settle();
        break;
      case 'click':
        sim.enqueue({ type: 'button', component: c.component, pressed: true });
        sim.run(c.ms);
        sim.enqueue({ type: 'button', component: c.component, pressed: false });
        settle();
        break;
      case 'wait':
        sim.run(c.ms);
        break;
      case 'waitFor': {
        const start = sim.tick;
        let r = evaluate(sim.snapshot(), c.cond);
        while (!r.ok && !r.error && sim.tick - start < c.timeout) {
          sim.run(5);
          r = evaluate(sim.snapshot(), c.cond);
        }
        step.status = r.ok ? 'ok' : 'fail';
        step.message = r.ok ? `${((sim.tick - start) / 1000).toFixed(2)} s sonra sağlandı` : (r.error ?? `${c.timeout / 1000} s içinde sağlanmadı (${r.detail})`);
        break;
      }
      case 'check': {
        let r = evaluate(sim.snapshot(), c.cond);
        const end = sim.tick + c.holdMs;
        while (r.ok && sim.tick < end) {
          sim.run(5);
          r = evaluate(sim.snapshot(), c.cond);
        }
        step.status = r.ok ? 'ok' : 'fail';
        step.message = r.ok ? r.detail : (r.error ?? `${c.holdMs ? `${((sim.tick - (end - c.holdMs)) / 1000).toFixed(2)} s sonra bozuldu: ` : ''}${r.detail}`);
        break;
      }
    }
    step.timeMs = sim.tick;
    if (step.status === 'fail') failed = true;
    steps.push(step);
  }
  const checks = steps.filter((s) => s.check);
  const passed = checks.filter((s) => s.status === 'ok').length;
  return { ok: !failed && passed === checks.length, steps, passed, total: checks.length };
}
