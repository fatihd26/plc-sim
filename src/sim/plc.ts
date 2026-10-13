// PLC çalışma zamanı: fiziksel terminaller, process image ve scan-cycle.
// Program yalnızca process image üzerinde çalışır; terminaller scan başında
// okunur ve scan sonunda yazılır.

import { AI_COUNT, AQ_COUNT, AREA_BYTES, bitIndex, type Area, type BitAddress } from './address';
import {
  compileProgram,
  createRuntime,
  executeProgram,
  type CompiledProgram,
  type LadderProgram,
  type LadderTrace,
  type Runtime,
} from './ladder';
import type { ModbusDataModel } from './modbus';

export class Plc {
  /** DI modülünün fiziksel giriş terminalleri (kablolama tarafından sürülür). */
  readonly diTerminals: boolean[] = new Array<boolean>(AREA_BYTES.I * 8).fill(false);
  /** DQ modülünün fiziksel çıkış terminalleri (yalnız scan sonunda güncellenir). */
  readonly dqTerminals: boolean[] = new Array<boolean>(AREA_BYTES.Q * 8).fill(false);
  /** Analog giriş modülünün ham değerleri (her tick güncellenir; scan başında %IW'ye kopyalanır). */
  readonly aiTerminals: number[] = new Array<number>(AI_COUNT).fill(0);
  /** Analog çıkış modülünün ham değerleri (scan sonunda %QW'den kopyalanır). */
  readonly aqTerminals: number[] = new Array<number>(AQ_COUNT).fill(0);

  /** Process image: PII (%I), PIQ (%Q) ve bayrak belleği (%M). */
  private readonly image: Record<Area, boolean[]> = {
    I: new Array<boolean>(AREA_BYTES.I * 8).fill(false),
    Q: new Array<boolean>(AREA_BYTES.Q * 8).fill(false),
    M: new Array<boolean>(AREA_BYTES.M * 8).fill(false),
  };

  private readonly program: CompiledProgram;
  private trace: LadderTrace = {};
  /** Zamanlayıcı, sayıcı ve kenar belleği (kalıcı değil: besleme kesilince sıfırlanır). */
  private runtime: Runtime = createRuntime();
  scanCount = 0;

  constructor(program: LadderProgram) {
    this.program = compileProgram(program);
  }

  /**
   * Tek bir scan-cycle: girişleri oku → programı çalıştır → çıkışları yaz.
   * `dtMs`: önceki scan'den bu yana geçen süre (zamanlayıcılar bununla ilerler).
   */
  scan(dtMs = 0): void {
    // 1. Giriş terminalleri → PII (scan boyunca sabit kalır)
    for (let i = 0; i < this.diTerminals.length; i++) this.image.I[i] = this.diTerminals[i]!;
    for (let i = 0; i < this.aiTerminals.length; i++) this.runtime.iw[i] = this.aiTerminals[i]!;

    // 2. Program yürütme
    this.trace = executeProgram(
      this.program,
      (a) => this.readBit(a),
      (a, v) => this.writeBit(a, v),
      this.runtime,
      dtMs,
    );

    // 3. PIQ → çıkış terminalleri
    for (let i = 0; i < this.dqTerminals.length; i++) this.dqTerminals[i] = this.image.Q[i]!;
    for (let i = 0; i < this.aqTerminals.length; i++) this.aqTerminals[i] = this.runtime.qw[i]!;

    this.scanCount++;
  }

  /** Besleme kesildi: kalıcı olmayan bellek ve çıkışlar sıfırlanır. */
  powerOff(): void {
    for (const area of ['I', 'Q', 'M'] as const) this.image[area].fill(false);
    this.diTerminals.fill(false);
    this.dqTerminals.fill(false);
    this.aiTerminals.fill(0);
    this.aqTerminals.fill(0);
    this.trace = {};
    this.runtime = createRuntime();
  }

  readBit(addr: BitAddress): boolean {
    return this.image[addr.area][bitIndex(addr)]!;
  }

  /** Alan içi düz indeksle bit okur (Modbus master için). */
  readBitAt(area: Area, index: number): boolean {
    return this.image[area][index] ?? false;
  }

  /** Alan içi düz indeksle bit yazar (Modbus master için). */
  writeBitAt(area: Area, index: number, value: boolean): void {
    if (index >= 0 && index < this.image[area].length) this.image[area][index] = value;
  }

  /** Hızlı sayıcı donanımı: darbe sayısını ekler (scan'den bağımsız, her tick). */
  countPulses(index: number, delta: number): void {
    if (index >= 0 && index < this.runtime.hc.length) this.runtime.hc[index] = this.runtime.hc[index]! + delta;
  }

  /** Hızlı sayıcı değerleri. */
  hscValues(): number[] {
    return [...this.runtime.hc];
  }

  /** %IW ve %QW kelimelerinin kopyası. */
  analogWords(): { iw: number[]; qw: number[] } {
    return { iw: [...this.runtime.iw], qw: [...this.runtime.qw] };
  }

  getWord(index: number): number {
    return this.runtime.words[index] ?? 0;
  }

  private writeBit(addr: BitAddress, value: boolean): void {
    this.image[addr.area][bitIndex(addr)] = value;
  }

  /** Son scan'in güç akışı izleme verisi. */
  get lastTrace(): LadderTrace {
    return this.trace;
  }

  /** Zamanlayıcıların geçen süresi [ms] ve çıkışı. */
  timers(): { et: number; q: boolean }[] {
    return this.runtime.timers.map((t) => ({ et: t.et, q: t.q }));
  }

  /** Sayıcıların değeri ve çıkışı. */
  counters(): { cv: number; q: boolean }[] {
    return this.runtime.counters.map((c) => ({ cv: c.cv, q: c.q }));
  }

  /** Kelime yazar (ör. ADC değeri); 0..65535'e kırpılır. */
  setWord(index: number, value: number): void {
    this.runtime.words[index] = Math.max(0, Math.min(0xffff, Math.round(value)));
  }

  /** %MW kelimelerinin kopyası. */
  wordsCopy(): number[] {
    return [...this.runtime.words];
  }

  /**
   * PLC'yi Modbus slave olarak gösteren görünüm; diziler process image'ın kendisidir:
   * coil n ↔ %Q (bit n), discrete input n ↔ %I (bit n), holding register n ↔ %MWn.
   * Program aynı %Q bitine yazıyorsa sonraki scan Modbus'un yazdığını ezer (gerçek PLC gibi).
   */
  modbusModel(): ModbusDataModel {
    return {
      coils: this.image.Q,
      discreteInputs: this.image.I,
      holdingRegisters: this.runtime.words,
      inputRegisters: new Uint16Array(0),
    };
  }

  imageCopy(area: Area): boolean[] {
    return [...this.image[area]];
  }
}
