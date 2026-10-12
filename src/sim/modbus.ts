// Modbus veri modeli, istek işleyici, RTU çerçeveleme ve sanal RS485 bus.
// Saf ve deterministiktir: zaman tick cinsinden ilerler, duvar saati kullanılmaz.
//
// Veri alanları:
//   coils              FC1 okuma, FC5/FC15 yazma   (PLC slave: %Q bitleri)
//   discreteInputs     FC2 okuma                   (PLC slave: %I bitleri)
//   holdingRegisters   FC3 okuma, FC6/FC16 yazma   (PLC slave: %MW kelimeleri)
//   inputRegisters     FC4 okuma                   (ör. ESP32 ADC)

export interface ModbusDataModel {
  coils: boolean[];
  discreteInputs: boolean[];
  holdingRegisters: Uint16Array;
  inputRegisters: Uint16Array;
}

export type ModbusRequest =
  | { fn: 1 | 2 | 3 | 4; addr: number; qty: number }
  | { fn: 5; addr: number; value: boolean }
  | { fn: 6; addr: number; value: number }
  | { fn: 15; addr: number; values: boolean[] }
  | { fn: 16; addr: number; values: number[] };

/** 1: geçersiz fonksiyon, 2: geçersiz adres, 3: geçersiz değer, 4: cihaz arızası. */
export type ModbusException = 1 | 2 | 3 | 4;

export type ModbusResponse =
  | { ok: true; fn: 1 | 2; bits: boolean[] }
  | { ok: true; fn: 3 | 4; words: number[] }
  | { ok: true; fn: 5 | 6 | 15 | 16 }
  | { ok: false; fn: number; exception: ModbusException };

/** Yanıt gelmedi (slave yok, kablo kopuk, A/B ters). */
export interface ModbusTimeout {
  ok: false;
  timeout: true;
}

/** Tek istekte okunabilecek/yazılabilecek en fazla öğe (Modbus spesifikasyonu). */
export const MAX_BITS = 2000;
export const MAX_WORDS = 125;

export function createModbusModel(n: { coils: number; discreteInputs: number; holding: number; input: number }): ModbusDataModel {
  return {
    coils: new Array<boolean>(n.coils).fill(false),
    discreteInputs: new Array<boolean>(n.discreteInputs).fill(false),
    holdingRegisters: new Uint16Array(n.holding),
    inputRegisters: new Uint16Array(n.input),
  };
}

const inRange = (len: number, addr: number, qty: number) =>
  Number.isInteger(addr) && Number.isInteger(qty) && addr >= 0 && qty >= 1 && addr + qty <= len;

const isWord = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xffff;

/** Slave tarafı: isteği veri modeline uygular ve yanıtı döndürür. */
export function handleRequest(m: ModbusDataModel, r: ModbusRequest): ModbusResponse {
  const fail = (exception: ModbusException): ModbusResponse => ({ ok: false, fn: r.fn, exception });
  switch (r.fn) {
    case 1:
    case 2: {
      if (r.qty > MAX_BITS) return fail(3);
      const src = r.fn === 1 ? m.coils : m.discreteInputs;
      if (!inRange(src.length, r.addr, r.qty)) return fail(2);
      return { ok: true, fn: r.fn, bits: src.slice(r.addr, r.addr + r.qty) };
    }
    case 3:
    case 4: {
      if (r.qty > MAX_WORDS) return fail(3);
      const src = r.fn === 3 ? m.holdingRegisters : m.inputRegisters;
      if (!inRange(src.length, r.addr, r.qty)) return fail(2);
      return { ok: true, fn: r.fn, words: [...src.subarray(r.addr, r.addr + r.qty)] };
    }
    case 5:
      if (!inRange(m.coils.length, r.addr, 1)) return fail(2);
      m.coils[r.addr] = r.value;
      return { ok: true, fn: 5 };
    case 6:
      if (!inRange(m.holdingRegisters.length, r.addr, 1)) return fail(2);
      if (!isWord(r.value)) return fail(3);
      m.holdingRegisters[r.addr] = r.value;
      return { ok: true, fn: 6 };
    case 15:
      if (r.values.length > MAX_BITS) return fail(3);
      if (!inRange(m.coils.length, r.addr, r.values.length)) return fail(2);
      r.values.forEach((v, i) => (m.coils[r.addr + i] = v));
      return { ok: true, fn: 15 };
    case 16:
      if (r.values.length > MAX_WORDS || !r.values.every(isWord)) return fail(3);
      if (!inRange(m.holdingRegisters.length, r.addr, r.values.length)) return fail(2);
      m.holdingRegisters.set(r.values, r.addr);
      return { ok: true, fn: 16 };
    default:
      return fail(1);
  }
}

// --- RTU çerçeveleme -----------------------------------------------------------------------

/** Modbus CRC16 (polinom 0xA001, başlangıç 0xFFFF). */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

const packBits = (bits: boolean[]) => {
  const out = new Array<number>(Math.ceil(bits.length / 8)).fill(0);
  bits.forEach((b, i) => {
    if (b) out[i >> 3]! |= 1 << (i & 7);
  });
  return out;
};

/** İsteğin PDU'su (fonksiyon kodu + veri). */
export function encodePdu(r: ModbusRequest): number[] {
  const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
  switch (r.fn) {
    case 1:
    case 2:
    case 3:
    case 4:
      return [r.fn, ...u16(r.addr), ...u16(r.qty)];
    case 5:
      return [5, ...u16(r.addr), ...(r.value ? [0xff, 0x00] : [0x00, 0x00])];
    case 6:
      return [6, ...u16(r.addr), ...u16(r.value)];
    case 15: {
      const data = packBits(r.values);
      return [15, ...u16(r.addr), ...u16(r.values.length), data.length, ...data];
    }
    case 16:
      return [16, ...u16(r.addr), ...u16(r.values.length), r.values.length * 2, ...r.values.flatMap(u16)];
  }
}

/** Yanıtın PDU'su. */
export function encodeResponsePdu(r: ModbusResponse): number[] {
  if (!r.ok) return [r.fn | 0x80, r.exception];
  switch (r.fn) {
    case 1:
    case 2: {
      const data = packBits(r.bits);
      return [r.fn, data.length, ...data];
    }
    case 3:
    case 4:
      return [r.fn, r.words.length * 2, ...r.words.flatMap((w) => [(w >> 8) & 0xff, w & 0xff])];
    default:
      // Yazma yanıtları isteği yankılar; uzunluk hesabı için sabit 5 bayt yeterli.
      return [r.fn, 0, 0, 0, 0];
  }
}

/** RTU çerçevesi: adres + PDU + CRC (düşük bayt önce). */
export function rtuFrame(unit: number, pdu: number[]): Uint8Array {
  const body = new Uint8Array([unit, ...pdu]);
  const crc = crc16(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body);
  frame[body.length] = crc & 0xff;
  frame[body.length + 1] = crc >> 8;
  return frame;
}

/**
 * RTU çerçeve süresi [ms]: karakter başına 11 bit (start, 8 veri, parite/stop) ve çerçeve sonu
 * 3,5 karakter sessizlik.
 */
export const rtuFrameMs = (baud: number, bytes: number) => Math.ceil(((bytes + 3.5) * 11 * 1000) / baud);

// --- Sanal RS485 bus -----------------------------------------------------------------------

/** Bus üzerindeki bir slave: adres ve veri modeli. */
export interface ModbusSlave {
  unit: number;
  model: ModbusDataModel;
}

export type ModbusResult = ModbusResponse | ModbusTimeout;

interface Transaction {
  id: number;
  unit: number;
  req: ModbusRequest;
  phase: 'request' | 'response' | 'waiting';
  /** Bu fazın bittiği tick. */
  untilTick: number;
  response?: ModbusResponse;
}

/**
 * Yarı çift yönlü RS485 bus: aynı anda tek işlem. İstek çerçevesi gönderilir, slave anında
 * işler, yanıt çerçevesi gönderilir. Adresli slave yoksa zaman aşımı beklenir. Unit 0
 * (broadcast) yazmaları tüm slave'lere uygulanır, yanıt dönmez.
 */
export class ModbusRtuBus {
  private readonly queue: Transaction[] = [];
  private current: Transaction | null = null;
  private nextId = 1;
  /** Tamamlanan işlemler (`take` ile alınır). */
  private readonly done = new Map<number, ModbusResult>();

  constructor(
    readonly baud: number,
    readonly timeoutMs = 200,
  ) {}

  /** İsteği kuyruğa ekler; dönen kimlikle sonuç `take` ile alınır. */
  submit(unit: number, req: ModbusRequest): number {
    const id = this.nextId++;
    this.queue.push({ id, unit, req, phase: 'request', untilTick: -1 });
    return id;
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /** Sonuç hazırsa döndürür ve listeden çıkarır. */
  take(id: number): ModbusResult | undefined {
    const r = this.done.get(id);
    if (r) this.done.delete(id);
    return r;
  }

  /** Her tick bir kez çağrılır. `slaves`: bu bus'a kablolanmış slave'ler. */
  step(tick: number, slaves: readonly ModbusSlave[]): void {
    if (!this.current) {
      const next = this.queue.shift();
      if (!next) return;
      next.untilTick = tick + rtuFrameMs(this.baud, rtuFrame(next.unit, encodePdu(next.req)).length);
      this.current = next;
    }
    const t = this.current;
    if (tick < t.untilTick) return;

    if (t.phase === 'request') {
      if (t.unit === 0) {
        for (const s of slaves) handleRequest(s.model, t.req);
        this.finish(t, { ok: true, fn: t.req.fn } as ModbusResponse);
        return;
      }
      const slave = slaves.find((s) => s.unit === t.unit);
      if (!slave) {
        t.phase = 'waiting';
        t.untilTick = tick + this.timeoutMs;
        return;
      }
      t.response = handleRequest(slave.model, t.req);
      t.phase = 'response';
      t.untilTick = tick + rtuFrameMs(this.baud, rtuFrame(t.unit, encodeResponsePdu(t.response)).length);
      return;
    }
    this.finish(t, t.phase === 'response' ? t.response! : { ok: false, timeout: true });
  }

  private finish(t: Transaction, result: ModbusResult): void {
    this.done.set(t.id, result);
    this.current = null;
  }
}
