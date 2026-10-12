// PLC Modbus RTU master: tarama tablosundaki satırları periyodik olarak bus'a gönderir, okunan
// değerleri PLC belleğine (%M bitleri, %MW kelimeleri) yazar, yazılacak değerleri PLC belleğinden
// (%I/%Q/%M bitleri, %MW) alır. Saf ve deterministiktir; zaman tick (ms) cinsindendir.

import { AREA_BYTES, MW_COUNT, parseAddress, parseWord, type Area } from './address';
import { MAX_BITS, MAX_WORDS, ModbusRtuBus, type ModbusRequest, type ModbusResult, type ModbusSlave } from './modbus';
import type { Plc } from './plc';

export type PollFn = 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16;

/** Tarama tablosu satırı (PLC bileşeninde saklanır). */
export interface ModbusPoll {
  id: string;
  /** Slave adresi (1..247). */
  unit: number;
  fn: PollFn;
  /** Slave'deki başlangıç adresi (0 tabanlı). */
  remote: number;
  /** Öğe sayısı (FC5/FC6'da 1). */
  qty: number;
  /** PLC'deki başlangıç adresi: bit işlevlerinde %M/%I/%Q biti, register işlevlerinde %MW. */
  local: string;
  /** Tekrar periyodu [ms]. */
  periodMs: number;
}

export const POLL_FUNCTIONS: { fn: PollFn; label: string; read: boolean; bits: boolean }[] = [
  { fn: 1, label: 'FC1 coil oku', read: true, bits: true },
  { fn: 2, label: 'FC2 discrete input oku', read: true, bits: true },
  { fn: 3, label: 'FC3 holding register oku', read: true, bits: false },
  { fn: 4, label: 'FC4 input register oku', read: true, bits: false },
  { fn: 5, label: 'FC5 tek coil yaz', read: false, bits: true },
  { fn: 6, label: 'FC6 tek register yaz', read: false, bits: false },
  { fn: 15, label: 'FC15 çoklu coil yaz', read: false, bits: true },
  { fn: 16, label: 'FC16 çoklu register yaz', read: false, bits: false },
];

const fnInfo = (fn: PollFn) => POLL_FUNCTIONS.find((f) => f.fn === fn)!;

type LocalTarget = { kind: 'bits'; area: Area; start: number } | { kind: 'words'; start: number };

/** Satırın PLC tarafındaki hedefini çözer; geçersizse hata metni fırlatır. */
function resolveLocal(p: ModbusPoll): LocalTarget {
  const info = fnInfo(p.fn);
  if (info.bits) {
    const a = parseAddress(p.local);
    if (info.read && a.area !== 'M') throw new Error('okunan bitler yalnız %M alanına yazılır');
    const start = a.byte * 8 + a.bit;
    if (start + p.qty > AREA_BYTES[a.area] * 8) throw new Error(`${p.local} + ${p.qty} bit alan dışına taşıyor`);
    return { kind: 'bits', area: a.area, start };
  }
  const w = parseWord(p.local);
  if (!w) throw new Error('register işlevlerinde yerel adres %MW olmalı');
  if (w.index + p.qty > MW_COUNT) throw new Error(`${p.local} + ${p.qty} kelime %MW${MW_COUNT - 1} sınırını aşıyor`);
  return { kind: 'words', start: w.index };
}

/** Satırı doğrular; sorun yoksa null. */
export function validatePoll(p: ModbusPoll): string | null {
  if (!POLL_FUNCTIONS.some((f) => f.fn === p.fn)) return `geçersiz işlev kodu ${p.fn}`;
  if (!Number.isInteger(p.unit) || p.unit < 1 || p.unit > 247) return 'slave adresi 1..247 olmalı';
  if (!Number.isInteger(p.remote) || p.remote < 0 || p.remote > 0xffff) return 'uzak adres 0..65535 olmalı';
  const single = p.fn === 5 || p.fn === 6;
  const max = fnInfo(p.fn).bits ? MAX_BITS : MAX_WORDS;
  if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > max || (single && p.qty !== 1)) {
    return single ? 'FC5/FC6 adedi 1 olmalı' : `adet 1..${max} olmalı`;
  }
  if (!Number.isInteger(p.periodMs) || p.periodMs < 10 || p.periodMs > 60_000) return 'periyot 10..60000 ms olmalı';
  try {
    resolveLocal(p);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

export type PollState = 'idle' | 'ok' | 'timeout' | 'exception' | 'busFault' | 'invalid';

export interface PollStatus {
  id: string;
  state: PollState;
  okCount: number;
  errorCount: number;
  /** Son hata veya bilgi metni. */
  detail: string | null;
  /** Son başarılı işlemde okunan/yazılan değerler (izleme için, en fazla 8). */
  values: (number | boolean)[];
}

const MAX_SHOWN = 8;

export class ModbusMaster {
  readonly bus: ModbusRtuBus;
  private readonly nextDue = new Map<string, number>();
  private readonly inFlight = new Map<number, ModbusPoll>();
  private readonly busyPolls = new Set<string>();
  readonly status = new Map<string, PollStatus>();

  constructor(
    readonly polls: readonly ModbusPoll[],
    baud: number,
    timeoutMs: number,
  ) {
    this.bus = new ModbusRtuBus(baud, timeoutMs);
    for (const p of polls) {
      const invalid = validatePoll(p);
      this.status.set(p.id, {
        id: p.id,
        state: invalid ? 'invalid' : 'idle',
        okCount: 0,
        errorCount: 0,
        detail: invalid,
        values: [],
      });
      this.nextDue.set(p.id, 0);
    }
  }

  get baud(): number {
    return this.bus.baud;
  }

  /**
   * Bir tick: zamanı gelen satırları kuyruğa ekler, bus'ı ilerletir, sonuçları PLC'ye uygular.
   * `slaves` null ise bus kullanılamaz (`fault` nedeniyle); satırlar busFault durumuna geçer.
   */
  step(tick: number, plc: Plc, slaves: readonly ModbusSlave[] | null, fault: string | null): void {
    if (!slaves) {
      for (const st of this.status.values()) {
        if (st.state !== 'invalid') Object.assign(st, { state: 'busFault', detail: fault });
      }
      return;
    }
    for (const p of this.polls) {
      const st = this.status.get(p.id)!;
      if (st.state === 'invalid' || this.busyPolls.has(p.id) || tick < this.nextDue.get(p.id)!) continue;
      this.nextDue.set(p.id, tick + p.periodMs);
      const req = this.request(p, plc);
      const txId = this.bus.submit(p.unit, req);
      this.inFlight.set(txId, p);
      this.busyPolls.add(p.id);
    }
    this.bus.step(tick, slaves);
    for (const [txId, p] of this.inFlight) {
      const result = this.bus.take(txId);
      if (!result) continue;
      this.inFlight.delete(txId);
      this.busyPolls.delete(p.id);
      this.apply(p, result, plc);
    }
  }

  /** Besleme kesildi: bekleyen işlemler bırakılır, satırlar baştan başlar. */
  reset(): void {
    this.inFlight.clear();
    this.busyPolls.clear();
    for (const p of this.polls) this.nextDue.set(p.id, 0);
    for (const st of this.status.values()) if (st.state !== 'invalid') Object.assign(st, { state: 'idle', detail: null });
    this.bus.clear();
  }

  private request(p: ModbusPoll, plc: Plc): ModbusRequest {
    const target = resolveLocal(p);
    const bits = () => {
      const t = target as Extract<LocalTarget, { kind: 'bits' }>;
      return Array.from({ length: p.qty }, (_, i) => plc.readBitAt(t.area, t.start + i));
    };
    const words = () => Array.from({ length: p.qty }, (_, i) => plc.getWord(target.start + i));
    switch (p.fn) {
      case 1:
      case 2:
      case 3:
      case 4:
        return { fn: p.fn, addr: p.remote, qty: p.qty };
      case 5:
        return { fn: 5, addr: p.remote, value: bits()[0]! };
      case 6:
        return { fn: 6, addr: p.remote, value: words()[0]! };
      case 15:
        return { fn: 15, addr: p.remote, values: bits() };
      case 16:
        return { fn: 16, addr: p.remote, values: words() };
    }
  }

  private apply(p: ModbusPoll, r: ModbusResult, plc: Plc): void {
    const st = this.status.get(p.id)!;
    if (!r.ok) {
      st.errorCount++;
      if ('timeout' in r) Object.assign(st, { state: 'timeout', detail: `slave ${p.unit} yanıt vermedi` });
      else Object.assign(st, { state: 'exception', detail: `istisna ${r.exception}` });
      return;
    }
    st.okCount++;
    st.state = 'ok';
    st.detail = null;
    const target = resolveLocal(p);
    if ('bits' in r && target.kind === 'bits') {
      r.bits.forEach((v, i) => plc.writeBitAt(target.area, target.start + i, v));
      st.values = r.bits.slice(0, MAX_SHOWN);
    } else if ('words' in r && target.kind === 'words') {
      r.words.forEach((v, i) => plc.setWord(target.start + i, v));
      st.values = r.words.slice(0, MAX_SHOWN);
    } else {
      // Yazma: gönderilen değerler
      st.values =
        target.kind === 'bits'
          ? Array.from({ length: Math.min(p.qty, MAX_SHOWN) }, (_, i) => plc.readBitAt(target.area, target.start + i))
          : Array.from({ length: Math.min(p.qty, MAX_SHOWN) }, (_, i) => plc.getWord(target.start + i));
    }
  }
}
