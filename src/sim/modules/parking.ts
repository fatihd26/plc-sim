// Otopark bariyeri sahnesi: giriş şeridinde bariyer kolu, bilet butonu ve loop dedektörleri,
// sınırlı park yeri ve çıkış şeridi. Öğrenci sayıcıyı (CTUD) ve emniyet kilidini sahnede görür:
// içerideki araç sayısı, DOLU levhası, kolun araca inmesi.
//
// Bariyer sürücüsü ve DOLU levhası 24 V DC sinyal girişlidir (UP / DN / FULL, yük sayılmaz,
// PLC çıkışına doğrudan bağlanır). Sensörler PNP'dir (L+ / M beslemesiyle).

import { num, paramReader } from '../spec';
import { defineModule } from './types';

/** Giriş şeridi (0..1, aracın ön ucu): araç boyu, boşluk, loop, durma noktası, kol çizgisi. */
export const PARKING = {
  car: 0.08,
  gap: 0.04,
  loopFrom: 0.36,
  loopTo: 0.49,
  stop: 0.47,
  arm: 0.5,
  /** Kol altı fotoselinin baktığı bölge. */
  safeFrom: 0.49,
  safeTo: 0.53,
  /** Çıkış şeridinde çıkış loop'u. */
  exitFrom: 0.45,
  exitTo: 0.55,
};
const P = PARKING;
/** Araç geçebilmesi için kolun en az açıklığı; araca değdiği yükseklik. */
const ARM_PASS = 0.9;
const ARM_HIT = 0.6;
/** Araç bariyerden yavaş geçer (duruştan kalkış): durma noktasından kol altı bölgesinin sonuna kadar. */
const SLOW = 0.4;
/** Sürücü bariyerde durduktan sonra bilete basma süresi; tekrar basma aralığı; basılı kalma. */
const TICKET_DELAY = 800;
const TICKET_REPEAT = 3000;
const PRESS_MS = 300;
const ARRIVALS = [1, 0.6, 1.4, 0.8, 1.2];
const STAYS = [1, 1.5, 0.7, 1.2, 0.9];
const MAX_QUEUE = 6;
export const MAX_SPACES = 8;

interface EntryCar {
  x: number;
  moving: boolean;
  ticketed: boolean;
  /** Bariyerde bekleme süresi; bir sonraki bilet basışına kalan süre. */
  waitMs: number;
  nextPressMs: number;
}

const spec = {
  type: 'parkingBarrier' as const,
  title: 'Otopark bariyeri',
  prefix: 'M',
  category: 'Sahneler' as const,
  description:
    'Girişte bariyer kolu, bilet butonu ve loop dedektörleri; sınırlı park yeri ve bariyersiz çıkış. Sinyal girişleri ' +
    '(24 V DC, yük sayılmaz): UP kolu kaldırır, DN indirir, FULL "DOLU" levhasını yakar. PNP sensörler (L+ / M): ' +
    'ENT bariyer önünde araç, TK bilet butonu, SAFE kol altında araç (fotosel), LSO kol açık, LSC kol kapalı, EX ' +
    'çıkış loop\'unda araç. DOLU yanarken gelen araçlar geri döner. Kol araca inerse çarpma, park yeri ' +
    'yokken giren araç taşma sayılır.',
  terminals: ['L+', 'M', 'UP', 'DN', 'FULL', 'ENT', 'TK', 'SAFE', 'LSO', 'LSC', 'EX'],
  params: [
    num('capacity', 'Park yeri sayısı', 4, 1, MAX_SPACES, 1),
    num('arrivalS', 'Ortalama araç geliş aralığı (0 = elle)', 4, 0, 120, 0.5, 's'),
    num('stayS', 'Ortalama park süresi', 25, 2, 600, 1, 's'),
    num('crossS', 'Aracın şeridi baştan sona geçme süresi', 4, 1, 30, 0.5, 's'),
    num('armS', 'Kolun açılma / kapanma süresi', 2, 0.5, 10, 0.5, 's'),
  ],
};

export const parkingBarrierModule = defineModule({
  spec,
  faults: [
    { key: 'safe', label: 'Kol altı fotoseli arızalı (aracı görmüyor)' },
    { key: 'lsc', label: 'LSC (kol kapalı) sınır sensörü arızalı' },
    { key: 'ticket', label: 'Bilet butonu arızalı' },
    { key: 'motor', label: 'Bariyer motoru arızalı (kol hareket etmiyor)' },
  ],
  create: (inst) => {
    const p = paramReader(spec, inst);
    const arrivalMs = p.num('arrivalS') * 1000;
    return {
      capacity: p.num('capacity'),
      arrivalMs,
      stayMs: p.num('stayS') * 1000,
      speed: 1 / (p.num('crossS') * 1000),
      armMs: p.num('armS') * 1000,
      since: arrivalMs * 0.8,
      nextArrival: 0,
      nextStay: 0,
      entry: [] as EntryCar[],
      /** Park etmiş araçların kalan süreleri. */
      parked: [] as number[],
      exit: [] as number[],
      /** Kol açıklığı: 0 = kapalı (şeridin üstünde), 1 = tam açık. */
      arm: 0,
      powered: false,
      up: false,
      down: false,
      full: false,
      pressMs: 0,
      both: false,
      hitting: false,
      hits: 0,
      overflows: 0,
      turnedAway: 0,
      left: 0,
    };
  },
  links: (d, net) => {
    if (!d.powered) return;
    const out = (t: string, on: boolean) => {
      if (on) net.source(t, 'P24');
    };
    out('ENT', d.entry.some((c) => c.x > P.loopFrom && c.x <= P.loopTo));
    out('TK', d.pressMs > 0 && !net.fault('ticket'));
    out('SAFE', underArm(d.entry) && !net.fault('safe'));
    out('LSO', d.arm >= 0.98);
    out('LSC', d.arm <= 0.02 && !net.fault('lsc'));
    out('EX', d.exit.some((x) => x > P.exitFrom && x - P.car < P.exitTo));
  },
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    d.up = d.powered && io.high('UP');
    d.down = d.powered && io.high('DN');
    d.full = d.powered && io.high('FULL');

    // Kol
    const both = d.up && d.down;
    if (both && !d.both) io.event('bariyer: aç ve kapat komutu birlikte geldi');
    d.both = both;
    let hitting = false;
    if (!io.fault('motor') && !both) {
      if (d.up) d.arm = Math.min(1, d.arm + dt / d.armMs);
      else if (d.down) {
        let next = Math.max(0, d.arm - dt / d.armMs);
        if (underArm(d.entry) && next < ARM_HIT) {
          next = Math.max(next, Math.min(d.arm, ARM_HIT));
          hitting = true;
        }
        d.arm = next;
      }
    }
    if (hitting && !d.hitting) {
      d.hits++;
      io.event('bariyer: kol aracın üstüne indi!');
    }
    d.hitting = hitting;

    // Gelen araçlar: DOLU yanıyorsa geri döner
    if (d.arrivalMs > 0) {
      d.since += dt;
      const interval = d.arrivalMs * ARRIVALS[d.nextArrival % ARRIVALS.length]!;
      if (d.since >= interval) {
        d.since = 0;
        d.nextArrival++;
        if (d.full) d.turnedAway++;
        else addCar(d);
      }
    }

    // Giriş şeridi
    d.pressMs = Math.max(0, d.pressMs - dt);
    const step = d.speed * dt;
    let ahead = Infinity;
    for (const car of d.entry) {
      const slow = car.x >= P.stop - 0.005 && car.x - P.car < P.safeTo;
      let limit = ahead - P.car - P.gap;
      // Her sürücü bilet makinesinde durur: kol açık olsa da bilet almadan geçmez
      if (car.x <= P.stop && (!car.ticketed || d.arm < ARM_PASS)) limit = Math.min(limit, P.stop);
      const next = Math.max(car.x, Math.min(car.x + (slow ? step * SLOW : step), limit));
      car.moving = next > car.x;
      car.x = next;
      ahead = car.x;
      // Sürücü bariyerde bekliyorsa bilet butonuna basar (açılmazsa arada bir tekrar)
      if (!car.moving && car.x >= P.stop - 0.005) {
        car.waitMs += dt;
        if (car.waitMs >= TICKET_DELAY) {
          car.nextPressMs -= dt;
          if (car.nextPressMs <= 0) {
            d.pressMs = PRESS_MS;
            car.ticketed = true;
            car.nextPressMs = TICKET_REPEAT;
          }
        }
      }
    }
    for (let n = d.entry.filter((c) => c.x >= 1).length; n > 0; n--) {
      if (d.parked.length >= d.capacity) {
        d.overflows++;
        io.event('otopark: boş yer yok, araç içeride yer arıyor');
      }
      d.parked.push(d.stayMs * STAYS[d.nextStay++ % STAYS.length]!);
    }
    d.entry = d.entry.filter((c) => c.x < 1);

    // Park ve çıkış (çıkışta bariyer yok)
    d.parked = d.parked.map((ms) => ms - dt);
    const lastExit = d.exit.at(-1);
    const exitFree = lastExit === undefined || lastExit - P.car >= P.gap;
    const ready = d.parked.findIndex((ms) => ms <= 0);
    if (ready >= 0 && exitFree) {
      d.parked.splice(ready, 1);
      d.exit.push(0);
    }
    d.exit = d.exit.map((x) => x + step);
    d.left += d.exit.filter((x) => x - P.car >= 1).length;
    d.exit = d.exit.filter((x) => x - P.car < 1);
  },
  command: (d, action, _v, io) => {
    // Elle eklenen araç DOLU levhasına bakmaz (ısrarcı sürücü)
    if (action === 'car' && !addCar(d)) io.event('girişte yer yok');
    if (action === 'ticket') d.pressMs = PRESS_MS;
  },
  state: (d) => ({
    type: 'parkingBarrier' as const,
    powered: d.powered,
    arm: d.arm,
    up: d.up,
    down: d.down,
    full: d.full,
    ticket: d.pressMs > 0,
    entry: d.entry.map((c) => c.x),
    entryMoving: d.entry.map((c) => c.moving),
    exit: [...d.exit],
    inLot: d.parked.length,
    capacity: d.capacity,
    loop: d.entry.some((c) => c.x > P.loopFrom && c.x <= P.loopTo),
    under: underArm(d.entry),
    exitLoop: d.exit.some((x) => x > P.exitFrom && x - P.car < P.exitTo),
    waiting: d.entry.filter((c) => !c.moving).length,
    hitting: d.hitting,
    hits: d.hits,
    overflows: d.overflows,
    turnedAway: d.turnedAway,
    left: d.left,
  }),
  signals: (s) => ({
    acik: { label: 'LSO kol açık', value: s.arm >= 0.98 },
    kapali: { label: 'LSC kol kapalı', value: s.arm <= 0.02 },
    kol: { label: 'Kol açıklığı', value: s.arm * 100, unit: '%' },
    loop: { label: 'ENT bariyer önünde araç', value: s.loop },
    bilet: { label: 'TK bilet butonu', value: s.ticket },
    kolAlti: { label: 'SAFE kol altında araç', value: s.under },
    cikis: { label: 'EX çıkış loop\'u', value: s.exitLoop },
    dolu: { label: 'DOLU levhası', value: s.full },
    otoparkta: { label: 'Otoparktaki araç', value: s.inLot },
    bekleyen: { label: 'Girişte bekleyen araç', value: s.waiting },
    cikan: { label: 'Çıkan araç', value: s.left },
    donen: { label: 'DOLU görüp dönen araç', value: s.turnedAway },
    carpma: { label: 'Kol araca indi', value: s.hits },
    tasma: { label: 'Yer yokken giren araç', value: s.overflows },
  }),
});

function underArm(entry: EntryCar[]) {
  return entry.some((c) => c.x > P.safeFrom && c.x - P.car < P.safeTo);
}

function addCar(d: { entry: EntryCar[] }): boolean {
  const last = d.entry.at(-1);
  if (d.entry.length >= MAX_QUEUE || (last && last.x - P.car < P.gap)) return false;
  d.entry.push({ x: 0, moving: false, ticketed: false, waitMs: 0, nextPressMs: 0 });
  return true;
}
