// Ladder komut kütüphanesi: editör paletinde ve sol kütüphanede gösterilen komutlar.

import { BOX_SPECS, type BoxType } from './boxes';
import type { CoilType } from './ladder';
import type { InstructionAction } from './ladderEdit';

/** Sürükle-bırakta komut anahtarını taşıyan veri türü. */
export const INSTR_MIME = 'application/x-plcsim-instruction';

export type InstructionGroup =
  | 'Bit mantığı'
  | 'Karşılaştırma'
  | 'Çıkışlar'
  | 'Zamanlayıcılar'
  | 'Sayıcılar'
  | 'Matematik'
  | 'Analog ve PID';

export const INSTRUCTION_GROUPS: InstructionGroup[] = [
  'Bit mantığı',
  'Karşılaştırma',
  'Çıkışlar',
  'Zamanlayıcılar',
  'Sayıcılar',
  'Matematik',
  'Analog ve PID',
];

export interface Instruction {
  key: string;
  group: InstructionGroup;
  /** Kısa sembol (palet düğmesinde). */
  symbol: string;
  title: string;
  description: string;
  action: InstructionAction;
}

const contact = (key: 'NO' | 'NC' | 'P' | 'N', symbol: string, title: string, description: string): Instruction => ({
  key,
  group: 'Bit mantığı',
  symbol,
  title,
  description,
  action: { kind: 'element', template: { kind: 'contact', contact: key } },
});

const cmp = (op: '==' | '<>' | '>' | '>=' | '<' | '<=', title: string): Instruction => ({
  key: `CMP${op}`,
  group: 'Karşılaştırma',
  symbol: op,
  title: `Karşılaştır ${op}`,
  description: `${title}: A ${op} B iken iletir. Operand: tamsayı, T0 (geçen süre ms), C0 (sayıcı değeri) veya %MW0.`,
  action: { kind: 'element', template: { kind: 'compare', op } },
});

const output = (
  key: CoilType,
  group: InstructionGroup,
  symbol: string,
  title: string,
  description: string,
): Instruction => ({ key, group, symbol, title, description, action: { kind: 'output', type: key } });

export const INSTRUCTIONS: Instruction[] = [
  contact('NO', '┤ ├', 'NO kontak', 'Bit 1 iken iletir (%I, %Q, %M, T, C).'),
  contact('NC', '┤/├', 'NC kontak', 'Bit 0 iken iletir.'),
  contact('P', '┤P├', 'Yükselen kenar', 'Bit 0→1 olduğu scan boyunca iletir (tek darbe).'),
  contact('N', '┤N├', 'Düşen kenar', 'Bit 1→0 olduğu scan boyunca iletir (tek darbe).'),
  cmp('==', 'Eşit'),
  cmp('<>', 'Eşit değil'),
  cmp('>', 'Büyük'),
  cmp('>=', 'Büyük eşit'),
  cmp('<', 'Küçük'),
  cmp('<=', 'Küçük eşit'),
  output('coil', 'Çıkışlar', '( )', 'Bobin', 'Rung enerjiliyken biti 1, değilse 0 yapar.'),
  output('ncoil', 'Çıkışlar', '(/)', 'Ters bobin', 'Rung enerjiliyken biti 0, değilse 1 yapar.'),
  output('set', 'Çıkışlar', '(S)', 'Set', 'Rung enerjilenince biti 1 yapar ve tutar.'),
  output('reset', 'Çıkışlar', '(R)', 'Reset', 'Rung enerjilenince biti 0 yapar; T/C adresinde zamanlayıcı/sayıcıyı sıfırlar.'),
  output('TON', 'Zamanlayıcılar', 'TON', 'Çekmede gecikmeli', 'Giriş PT süresi kesintisiz 1 kalınca Q = 1.'),
  output('TOF', 'Zamanlayıcılar', 'TOF', 'Bırakmada gecikmeli', 'Giriş 1 iken Q = 1; giriş düşünce PT sonra Q = 0.'),
  output('TP', 'Zamanlayıcılar', 'TP', 'Darbe', 'Yükselen kenarda PT süresince Q = 1 (sabit uzunlukta darbe).'),
  output('TONR', 'Zamanlayıcılar', 'TONR', 'Kalıcı çekmede gecikmeli', 'Giriş 1 iken süre birikir, giriş düşünce korunur; R ile sıfırlanır.'),
  output('CTU', 'Sayıcılar', 'CTU', 'Yukarı sayıcı', 'Her yükselen kenarda CV + 1; CV ≥ PV iken Q = 1. R sıfırlar.'),
  output('CTD', 'Sayıcılar', 'CTD', 'Aşağı sayıcı', 'Her yükselen kenarda CV − 1; CV ≤ 0 iken Q = 1. LD, CV = PV yükler.'),
  output('CTUD', 'Sayıcılar', 'CTUD', 'Yukarı/aşağı sayıcı', 'Rung yukarı (CU), CD girişi aşağı sayar; CV ≥ PV iken Q = 1. R sıfırlar.'),
  ...(['MOVE', 'ADD', 'SUB', 'MUL', 'DIV'] as BoxType[]).map((t) => box(t, 'Matematik')),
  ...(['SCALE', 'PID'] as BoxType[]).map((t) => box(t, 'Analog ve PID')),
];

function box(type: BoxType, group: InstructionGroup): Instruction {
  const s = BOX_SPECS[type];
  return output(type, group, type, s.title, `${s.description} Çıkış (OUT): %MW veya %QW.`);
}
