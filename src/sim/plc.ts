// PLC çalışma zamanı: fiziksel terminaller, process image ve scan-cycle.
// Program yalnızca process image üzerinde çalışır; terminaller scan başında
// okunur ve scan sonunda yazılır.

import { AREA_BYTES, bitIndex, type Area, type BitAddress } from './address';
import { compileProgram, executeProgram, type CompiledProgram, type LadderProgram, type LadderTrace } from './ladder';

export class Plc {
  /** DI modülünün fiziksel giriş terminalleri (kablolama tarafından sürülür). */
  readonly diTerminals: boolean[] = new Array<boolean>(AREA_BYTES.I * 8).fill(false);
  /** DQ modülünün fiziksel çıkış terminalleri (yalnız scan sonunda güncellenir). */
  readonly dqTerminals: boolean[] = new Array<boolean>(AREA_BYTES.Q * 8).fill(false);

  /** Process image: PII (%I), PIQ (%Q) ve bayrak belleği (%M). */
  private readonly image: Record<Area, boolean[]> = {
    I: new Array<boolean>(AREA_BYTES.I * 8).fill(false),
    Q: new Array<boolean>(AREA_BYTES.Q * 8).fill(false),
    M: new Array<boolean>(AREA_BYTES.M * 8).fill(false),
  };

  private readonly program: CompiledProgram;
  private trace: LadderTrace = {};
  scanCount = 0;

  constructor(program: LadderProgram) {
    this.program = compileProgram(program);
  }

  /** Tek bir scan-cycle: girişleri oku → programı çalıştır → çıkışları yaz. */
  scan(): void {
    // 1. Giriş terminalleri → PII (scan boyunca sabit kalır)
    for (let i = 0; i < this.diTerminals.length; i++) this.image.I[i] = this.diTerminals[i]!;

    // 2. Program yürütme
    this.trace = executeProgram(
      this.program,
      (a) => this.readBit(a),
      (a, v) => this.writeBit(a, v),
    );

    // 3. PIQ → çıkış terminalleri
    for (let i = 0; i < this.dqTerminals.length; i++) this.dqTerminals[i] = this.image.Q[i]!;

    this.scanCount++;
  }

  /** Besleme kesildi: kalıcı olmayan bellek ve çıkışlar sıfırlanır. */
  powerOff(): void {
    for (const area of ['I', 'Q', 'M'] as const) this.image[area].fill(false);
    this.diTerminals.fill(false);
    this.dqTerminals.fill(false);
    this.trace = {};
  }

  readBit(addr: BitAddress): boolean {
    return this.image[addr.area][bitIndex(addr)]!;
  }

  private writeBit(addr: BitAddress, value: boolean): void {
    this.image[addr.area][bitIndex(addr)] = value;
  }

  /** Son scan'in güç akışı izleme verisi. */
  get lastTrace(): LadderTrace {
    return this.trace;
  }

  imageCopy(area: Area): boolean[] {
    return [...this.image[area]];
  }
}
