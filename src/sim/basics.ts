// Başlangıç seviyesi şemaları: PLC'siz, yalnız buton, röle, kontaktör ve lambayla kurulan
// kumanda devreleri. Eğitim dersleri (src/learn) ve röle mantığı görevleri (tasks.ts) kullanır.
// Görev çözümlerinde kumanda kabloları ayrı tutulur; görev şeması bunlar çıkarılarak kurulur.

import { builder } from './build';
import type { Schematic } from './schematic';

type B = ReturnType<typeof builder>;

const lamp = (b: B, id: string, x: number, y: number, color = 'green') =>
  b.add(id, 'lamp', x, y, { params: { voltage: '24DC', color } });

/** Ders 1: G1 24 V doğrudan P1 lambasını besler. */
export function circuitLesson(): Schematic {
  const b = builder('Ders: devre ve potansiyel', [{ id: 'p1', title: 'Devre' }]);
  b.add('G1', 'psu24', 40, 20);
  lamp(b, 'P1', 80, 200);
  b.wire('G1:L+', 'P1:X1').wire('P1:X2', 'G1:M');
  return b.build();
}

/** Ders 2: S1 (NO) P1'i, S2 (NC) P2'yi yakar. */
export function contactsLesson(): Schematic {
  const b = builder('Ders: NO ve NC kontak', [{ id: 'p1', title: 'Kontaklar' }]);
  b.add('G1', 'psu24', 40, 20);
  b.add('S1', 'buttonNO', 60, 140);
  b.add('S2', 'buttonNC', 220, 140);
  lamp(b, 'P1', 60, 300);
  lamp(b, 'P2', 220, 300, 'red');
  b.wire('G1:L+', 'S1:13').wire('S1:14', 'P1:X1').wire('P1:X2', 'G1:M');
  b.wire('G1:L+', 'S2:11').wire('S2:12', 'P2:X1').wire('P2:X2', 'G1:M');
  return b.build();
}

/** Görev 1 çözümü: S1 basılıyken K1 rölesi çeker, 13-14 kontağı P1'i yakar. */
export function lampRelaySolution(): Schematic {
  const b = builder('Lamba yakma (röle ile)', [{ id: 'p1', title: 'Kumanda' }]);
  b.add('G1', 'psu24', 40, 20);
  b.add('S1', 'buttonNO', 120, 140);
  b.add('K1', 'relay', 60, 280);
  lamp(b, 'P1', 220, 420);
  b.wire('G1:L+', 'S1:13').wire('S1:14', 'K1:A1').wire('K1:A2', 'G1:M');
  b.wire('G1:L+', 'K1:13').wire('K1:14', 'P1:X1').wire('P1:X2', 'G1:M');
  return b.build();
}

/** Görev 2 çözümü: S1 start, S2 stop (NC); K1 13-14 kontağıyla mühürlenir, 23-24 kontağı P1'i yakar. */
export function sealRelaySolution(): Schematic {
  const b = builder('Röle ile start-stop', [{ id: 'p1', title: 'Kumanda' }]);
  b.add('G1', 'psu24', 40, 20);
  b.add('S2', 'buttonNC', 60, 140);
  b.add('S1', 'buttonNO', 180, 140);
  b.add('K1', 'relay', 100, 300);
  lamp(b, 'P1', 260, 440);
  b.wire('G1:L+', 'S2:11').wire('S2:12', 'S1:13').wire('S1:14', 'K1:A1').wire('K1:A2', 'G1:M');
  // Mühür: K1 13-14, S1'e paralel
  b.wire('S2:12', 'K1:13').wire('K1:14', 'S1:14');
  b.wire('G1:L+', 'K1:23').wire('K1:24', 'P1:X1').wire('P1:X2', 'G1:M');
  return b.build();
}

/** İleri-geri motorun güç devresi: K2 L1 ile L3'ü yer değiştirir (dönüş yönü ters). */
function reversingPower(b: B) {
  b.add('X1', 'mains3', 40, 20);
  b.add('K1', 'contactor', 40, 160);
  b.add('K2', 'contactor', 200, 160);
  b.add('F2', 'thermal', 40, 320);
  b.add('M1', 'motor3', 40, 470);
  b.add('G1', 'psu24', 420, 20);
  b.add('S0', 'buttonNC', 420, 140);
  b.add('S1', 'buttonNO', 520, 140);
  b.add('S2', 'buttonNO', 620, 140);
  b.wire('X1:L1', 'K1:1').wire('X1:L2', 'K1:3').wire('X1:L3', 'K1:5');
  b.wire('X1:L1', 'K2:1').wire('X1:L2', 'K2:3').wire('X1:L3', 'K2:5');
  b.wire('K1:2', 'F2:1').wire('K1:4', 'F2:3').wire('K1:6', 'F2:5');
  b.wire('K2:2', 'F2:5').wire('K2:4', 'F2:3').wire('K2:6', 'F2:1');
  b.wire('F2:2', 'M1:U').wire('F2:4', 'M1:V').wire('F2:6', 'M1:W');
}

/** Çıkış görevi başlangıcı: güç devresi kurulu, kumanda kabloları öğrencide. */
export function reversingStarter(): Schematic {
  const b = builder('İleri-geri motor', [{ id: 'p1', title: 'Güç ve kumanda' }]);
  reversingPower(b);
  return b.build();
}

/**
 * Çıkış görevi çözümü: S0 stop, S1 ileri, S2 geri; her yön kendi 13-14 kontağıyla mühürlenir,
 * karşı kontaktörün 21-22 NC kontağı bobinin önünde (elektriksel kilitleme). Termik 95-96 hepsini keser.
 */
export function reversingSolution(): Schematic {
  const b = builder('İleri-geri motor', [{ id: 'p1', title: 'Güç ve kumanda' }]);
  reversingPower(b);
  b.wire('G1:L+', 'F2:95').wire('F2:96', 'S0:11');
  b.wire('S0:12', 'S1:13').wire('S1:14', 'K2:21').wire('K2:22', 'K1:A1').wire('K1:A2', 'G1:M');
  b.wire('S0:12', 'K1:13').wire('K1:14', 'S1:14');
  b.wire('S0:12', 'S2:13').wire('S2:14', 'K1:21').wire('K1:22', 'K2:A1').wire('K2:A2', 'G1:M');
  b.wire('S0:12', 'K2:13').wire('K2:14', 'S2:14');
  return b.build();
}

/** Ders 3 (koruma): röle mantığıyla start-stop motor; termik hızlı açsın diye ısıl sabiti kısa. */
export function protectionLesson(): Schematic {
  const b = builder('Ders: koruma', [{ id: 'p1', title: 'Güç ve kumanda' }]);
  b.add('X1', 'mains3', 40, 20);
  b.add('K1', 'contactor', 40, 160);
  b.add('F2', 'thermal', 40, 320, { params: { setCurrentA: 4, tauS: 3 } });
  b.add('M1', 'motor3', 40, 470);
  b.add('G1', 'psu24', 320, 20);
  b.add('S2', 'buttonNC', 340, 140);
  b.add('S1', 'buttonNO', 460, 140);
  b.wire('X1:L1', 'K1:1').wire('X1:L2', 'K1:3').wire('X1:L3', 'K1:5');
  b.wire('K1:2', 'F2:1').wire('K1:4', 'F2:3').wire('K1:6', 'F2:5');
  b.wire('F2:2', 'M1:U').wire('F2:4', 'M1:V').wire('F2:6', 'M1:W');
  b.wire('G1:L+', 'F2:95').wire('F2:96', 'S2:11');
  b.wire('S2:12', 'S1:13').wire('S1:14', 'K1:A1').wire('K1:A2', 'G1:M');
  b.wire('S2:12', 'K1:13').wire('K1:14', 'S1:14');
  return b.build();
}

/** Çözüm şemasından kabloları çıkarır (bileşenler yerinde kalır). */
export function withoutWires(s: Schematic): Schematic {
  return { ...s, wires: [] };
}
