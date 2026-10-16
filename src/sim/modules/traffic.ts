// Trafik sahneleri: tek yönlü yol ve iki yollu kavşak (yaya geçidi ve yaya butonuyla).
// Öğrenci ladder'daki zamanlayıcıların sonucunu sahnede görür: araçlar yeşilde geçer, kırmızıda
// durma çizgisinde birikir; yanlış programda çatışma, kaza riski ve yaya tehlikesi görünür.
//
// Sinyal kafaları LED sürücü kartıyla gelir: lamba uçları 24 V DC sinyal girişidir (PLC girişi
// gibi yük sayılmaz), bu yüzden PLC çıkışına doğrudan bağlanır. Kart L+ / M ile beslenir.

import { num, paramReader } from '../spec';
import { defineModule, type ModuleIo } from './types';

/** Araç boyu ve araçlar arası boşluk (şerit boyuna oranla). */
const CAR = 0.08;
const GAP = 0.04;
/** Sarı yandığı an durma çizgisine bu kadar yakın olan araç duramaz, geçer. */
const COMMIT = 0.03;
/** Geliş aralığı çarpanları: araçlar düzenli ama tekdüze olmayan aralıklarla gelir. */
const ARRIVALS = [1, 0.6, 1.4, 0.8, 1.2];
const MAX_CARS = 10;

interface Car {
  /** Aracın ön ucu (0 = şeridin başı, 1 = sonu). */
  x: number;
  moving: boolean;
  /** Sarı yandığında duramayacak kadar yakındı: geçer. */
  committed: boolean;
}

/** Bir sinyal kafasının yanan lambaları. */
interface Head {
  red: boolean;
  yellow: boolean;
  green: boolean;
}

const headOf = (io: ModuleIo, powered: boolean, r: string, y: string, g: string, faultPrefix = ''): Head => ({
  red: powered && io.high(r) && !io.fault(`${faultPrefix}red`),
  yellow: powered && io.high(y) && !io.fault(`${faultPrefix}yellow`),
  green: powered && io.high(g) && !io.fault(`${faultPrefix}green`),
});

/** Yeşil, kırmızı veya sarıyla birlikte yanıyor (geçersiz gösterim). */
const invalid = (h: Head) => h.green && (h.red || h.yellow);
/** Bu kafa araçlara yol veriyor mu (yeşil ya da sarı). */
const open = (h: Head) => (h.green || h.yellow) && !h.red;

/** Tek şeritli, tek yönlü araç akışı. */
class Lane {
  cars: Car[] = [];
  passed = 0;
  private since: number;
  private next = 0;
  private wasYellow = false;

  constructor(
    readonly stopAt: number,
    private readonly arrivalMs: number,
    private readonly speed: number,
    /** İlk aracın gelişi (geliş aralığına oranla). */
    phase = 0.8,
  ) {
    this.since = arrivalMs * phase;
  }

  add(): boolean {
    const last = this.cars.at(-1);
    if (this.cars.length >= MAX_CARS || (last && last.x - CAR < GAP)) return false;
    this.cars.push({ x: 0, moving: false, committed: false });
    return true;
  }

  update(h: Head, dt: number) {
    if (this.arrivalMs > 0) {
      this.since += dt;
      const interval = this.arrivalMs * ARRIVALS[this.next % ARRIVALS.length]!;
      if (this.since >= interval && this.add()) {
        this.since = 0;
        this.next++;
      }
    }
    const yellowOnly = h.yellow && !h.red && !h.green;
    if (yellowOnly && !this.wasYellow) for (const c of this.cars) c.committed = c.moving && c.x >= this.stopAt - COMMIT;
    this.wasYellow = yellowOnly;
    const go = h.green && !h.red;
    const step = this.speed * dt;
    let ahead = Infinity;
    for (const car of this.cars) {
      let limit = ahead - CAR - GAP;
      const mustStop = yellowOnly ? !car.committed : !go;
      if (car.x <= this.stopAt && mustStop) limit = Math.min(limit, this.stopAt);
      const next = Math.max(car.x, Math.min(car.x + step, limit));
      car.moving = next > car.x;
      car.x = next;
      ahead = car.x;
    }
    const before = this.cars.length;
    this.cars = this.cars.filter((c) => c.x - CAR < 1);
    this.passed += before - this.cars.length;
  }

  /** [a, b] aralığında (kısmen de olsa) araç var mı. */
  occupied(a: number, b: number, movingOnly = false) {
    return this.cars.some((c) => c.x > a && c.x - CAR < b && (!movingOnly || c.moving));
  }

  get waiting() {
    return this.cars.filter((c) => !c.moving && c.x <= this.stopAt).length;
  }

  view() {
    return { cars: this.cars.map((c) => c.x), moving: this.cars.map((c) => c.moving), stopAt: this.stopAt, passed: this.passed, waiting: this.waiting };
  }
}

const MAX_PEDS = 6;
/** Yaya butonu çıkışının basılı kalma süresi. */
const PRESS_MS = 300;

/** Yaya geçidinin yayaları: kaldırımda bekleyenler (taraf başına) ve geçenler. */
class Crowd {
  waiting: number[];
  /** Geçen yayalar: ilerleme 0..1 (negatif = kaldırımda adım atmak üzere) ve geldiği taraf. */
  walkers: { w: number; side: number }[] = [];
  passed = 0;
  pressMs = 0;
  private since = 0;
  private side = 0;

  constructor(
    sides: number,
    private readonly walkMs: number,
    private readonly arrivalMs: number,
  ) {
    this.waiting = new Array<number>(sides).fill(0);
  }

  /** Yaya gelir (taraflar sırayla) ve butona basar; bekleyen çoksa false. */
  arrive(): boolean {
    if (this.waiting.reduce((a, b) => a + b, 0) >= MAX_PEDS) return false;
    this.waiting[this.side]!++;
    this.side = (this.side + 1) % this.waiting.length;
    this.pressMs = PRESS_MS;
    return true;
  }

  update(green: boolean, dt: number) {
    this.pressMs = Math.max(0, this.pressMs - dt);
    if (this.arrivalMs > 0) {
      this.since += dt;
      if (this.since >= this.arrivalMs) {
        this.since = 0;
        this.arrive();
      }
    }
    if (green)
      this.waiting.forEach((n, side) => {
        for (let i = 0; i < n; i++) this.walkers.push({ w: -i * 0.08, side });
        this.waiting[side] = 0;
      });
    for (const p of this.walkers) p.w += dt / this.walkMs;
    const before = this.walkers.length;
    this.walkers = this.walkers.filter((p) => p.w < 1);
    this.passed += before - this.walkers.length;
  }

  get onCrossing() {
    return this.walkers.some((p) => p.w >= 0);
  }

  get waitingTotal() {
    return this.waiting.reduce((a, b) => a + b, 0);
  }
}

const LANE_PARAMS = (arrival: number) => [
  num('arrivalS', 'Ortalama araç geliş aralığı (0 = elle)', arrival, 0, 60, 0.5, 's'),
  num('crossS', 'Aracın yolu baştan sona geçme süresi', 4, 1, 30, 0.5, 's'),
];

// --- Tek yönlü yol --------------------------------------------------------------------------

const spec = {
  type: 'trafficLight' as const,
  title: 'Trafik ışığı (yol ve araçlar)',
  prefix: 'H',
  category: 'Sahneler' as const,
  description:
    'Tek yönlü yol ve sinyal kafası. R, Y, G LED sürücü kartının 24 V DC sinyal girişleridir (yük sayılmaz), ' +
    'PLC çıkışına doğrudan bağlanır; kart L+ / M ile beslenir. Araçlar yeşilde geçer, kırmızıda ve sarıda ' +
    'durma çizgisinde bekler. Yeşil, kırmızı veya sarıyla birlikte yanarsa çatışma sayılır. Simülasyonda yola ' +
    'tıklayınca araç eklenir.',
  terminals: ['L+', 'M', 'R', 'Y', 'G'],
  params: LANE_PARAMS(3),
};

export const trafficLightModule = defineModule({
  spec,
  faults: [
    { key: 'red', label: 'Kırmızı LED yanık' },
    { key: 'yellow', label: 'Sarı LED yanık' },
    { key: 'green', label: 'Yeşil LED yanık' },
  ],
  create: (inst) => {
    const p = paramReader(spec, inst);
    return {
      lane: new Lane(0.58, p.num('arrivalS') * 1000, 1 / (p.num('crossS') * 1000)),
      powered: false,
      head: { red: false, yellow: false, green: false } as Head,
      conflicts: 0,
      conflict: false,
    };
  },
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    d.head = headOf(io, d.powered, 'R', 'Y', 'G');
    const conflict = invalid(d.head);
    if (conflict && !d.conflict) {
      d.conflicts++;
      io.event('trafik ışığı: yeşil, kırmızı veya sarıyla birlikte yanıyor!');
    }
    d.conflict = conflict;
    d.lane.update(d.head, dt);
  },
  command: (d, action, _v, io) => {
    if (action === 'addCar' && !d.lane.add()) io.event('yolun başında yer yok');
  },
  state: (d) => {
    const l = d.lane.view();
    return {
      type: 'trafficLight' as const,
      powered: d.powered,
      ...d.head,
      ...l,
      carLength: CAR,
      conflict: d.conflict,
      conflicts: d.conflicts,
    };
  },
  signals: (s) => ({
    kirmizi: { label: 'Kırmızı yanıyor', value: s.red },
    sari: { label: 'Sarı yanıyor', value: s.yellow },
    yesil: { label: 'Yeşil yanıyor', value: s.green },
    gecen: { label: 'Geçen araç', value: s.passed },
    bekleyen: { label: 'Bekleyen araç', value: s.waiting },
    catisma: { label: 'Çatışma (yeşil + kırmızı/sarı)', value: s.conflicts },
  }),
});

// --- Kavşak ---------------------------------------------------------------------------------
//
// A: ana yol (batıdan doğuya), B: yan yol (kuzeyden güneye). Yaya geçidi A yolunun üzerinde,
// kavşaktan önce; yayalar A yolunu karşıdan karşıya geçer. Şerit konumları (0..1) görünümün
// ölçüleriyle eşleşir (src/ui/devices/traffic.tsx).

export const JUNCTION = {
  /** A şeridi: durma çizgisi, yaya geçidi, kavşak kutusu. */
  a: { stop: 0.3, walkFrom: 0.321, walkTo: 0.393, boxFrom: 0.436, boxTo: 0.564 },
  /** B şeridi: durma çizgisi, kavşak kutusu. */
  b: { stop: 0.436, boxFrom: 0.4545, boxTo: 0.618 },
};
const junctionSpec = {
  type: 'trafficJunction' as const,
  title: 'Kavşak (iki yol + yaya geçidi)',
  prefix: 'H',
  category: 'Sahneler' as const,
  description:
    'A ana yolu (batı → doğu) ve B yan yolu (kuzey → güney) kesişir; A yolunda yaya geçidi var. Sinyal girişleri ' +
    '(24 V DC, yük sayılmaz, PLC çıkışına doğrudan): A ışığı AR/AY/AG, B ışığı BR/BY/BG, yaya ışığı PR/PG. PB yaya ' +
    'butonu çıkışıdır (PNP, basılıyken +24 V). Kart L+ / M ile beslenir. Gelen yaya butona basar, yaya yeşilinde ' +
    'karşıya geçer. A ve B birlikte yol verirse veya yaya yeşili A yeşiliyle birlikte yanarsa çatışma; iki yoldan ' +
    'araçlar kavşakta karşılaşırsa kaza riski; yaya geçitteyken A araçları hareket ederse yaya tehlikesi sayılır.',
  terminals: ['L+', 'M', 'AR', 'AY', 'AG', 'BR', 'BY', 'BG', 'PR', 'PG', 'PB'],
  params: [
    num('arrivalAS', 'A yolu araç geliş aralığı (0 = elle)', 2.5, 0, 60, 0.5, 's'),
    num('arrivalBS', 'B yolu araç geliş aralığı (0 = elle)', 4, 0, 60, 0.5, 's'),
    num('crossS', 'Aracın yolu baştan sona geçme süresi', 4, 1, 30, 0.5, 's'),
    num('pedS', 'Yaya geliş aralığı (0 = elle)', 0, 0, 120, 1, 's'),
    num('walkS', 'Yayanın karşıya geçme süresi', 2.5, 0.5, 20, 0.5, 's'),
  ],
};

export const trafficJunctionModule = defineModule({
  spec: junctionSpec,
  faults: [
    { key: 'a-red', label: 'A kırmızı LED yanık' },
    { key: 'a-green', label: 'A yeşil LED yanık' },
    { key: 'b-red', label: 'B kırmızı LED yanık' },
    { key: 'b-green', label: 'B yeşil LED yanık' },
    { key: 'p-green', label: 'Yaya yeşil LED yanık' },
    { key: 'button', label: 'Yaya butonu arızalı (basınca sinyal yok)' },
  ],
  create: (inst) => {
    const p = paramReader(junctionSpec, inst);
    const speed = 1 / (p.num('crossS') * 1000);
    return {
      a: new Lane(JUNCTION.a.stop, p.num('arrivalAS') * 1000, speed, 0.5),
      b: new Lane(JUNCTION.b.stop, p.num('arrivalBS') * 1000, speed, 0.9),
      peds: new Crowd(1, p.num('walkS') * 1000, p.num('pedS') * 1000),
      powered: false,
      ha: { red: false, yellow: false, green: false } as Head,
      hb: { red: false, yellow: false, green: false } as Head,
      pedRed: false,
      pedGreen: false,
      conflict: false,
      conflicts: 0,
      crash: false,
      crashes: 0,
      danger: false,
      dangers: 0,
    };
  },
  links: (d, net) => {
    if (d.powered && d.peds.pressMs > 0 && !net.fault('button')) net.source('PB', 'P24');
  },
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    d.ha = headOf(io, d.powered, 'AR', 'AY', 'AG', 'a-');
    d.hb = headOf(io, d.powered, 'BR', 'BY', 'BG', 'b-');
    d.pedRed = d.powered && io.high('PR');
    d.pedGreen = d.powered && io.high('PG') && !io.fault('p-green');

    // Gösterim çatışması: aynı kafada yeşil + kırmızı/sarı, iki yol birlikte, yaya yeşili + A
    const conflict = invalid(d.ha) || invalid(d.hb) || (open(d.ha) && open(d.hb)) || (d.pedGreen && (d.pedRed || open(d.ha)));
    if (conflict && !d.conflict) {
      d.conflicts++;
      io.event('kavşak: çakışan yeşiller! (A ile B ya da yaya ile A aynı anda yol buluyor)');
    }
    d.conflict = conflict;

    d.peds.update(d.pedGreen && !d.pedRed, dt);
    const onCrossing = d.peds.onCrossing;

    // Araçlar yalnız kendi ışıklarına uyar: yayayı ışık korur, sürücü değil
    d.a.update(d.ha, dt);
    d.b.update(d.hb, dt);

    const danger = onCrossing && d.a.occupied(JUNCTION.a.walkFrom, JUNCTION.a.walkTo, true);
    if (danger && !d.danger) {
      d.dangers++;
      io.event('kavşak: yaya geçitteyken araç geçti!');
    }
    d.danger = danger;
    const crash = d.a.occupied(JUNCTION.a.boxFrom, JUNCTION.a.boxTo) && d.b.occupied(JUNCTION.b.boxFrom, JUNCTION.b.boxTo);
    if (crash && !d.crash) {
      d.crashes++;
      io.event('kavşak: iki yoldan gelen araçlar kavşakta karşılaştı (kaza riski)!');
    }
    d.crash = crash;
  },
  command: (d, action, _v, io) => {
    if (action === 'pedestrian') {
      if (!d.peds.arrive()) io.event('geçitte bekleyen yaya çok');
    } else if (action === 'press') {
      d.peds.pressMs = PRESS_MS;
    } else if (action === 'carA' && !d.a.add()) io.event('A yolunun başında yer yok');
    else if (action === 'carB' && !d.b.add()) io.event('B yolunun başında yer yok');
  },
  state: (d) => ({
    type: 'trafficJunction' as const,
    powered: d.powered,
    a: { ...d.ha, ...d.a.view() },
    b: { ...d.hb, ...d.b.view() },
    carLength: CAR,
    pedRed: d.pedRed,
    pedGreen: d.pedGreen,
    pedWaiting: d.peds.waitingTotal,
    walkers: d.peds.walkers.map((w) => w.w),
    pedPassed: d.peds.passed,
    button: d.peds.pressMs > 0,
    conflict: d.conflict,
    conflicts: d.conflicts,
    crash: d.crash,
    crashes: d.crashes,
    danger: d.danger,
    dangers: d.dangers,
  }),
  signals: (s) => ({
    aKirmizi: { label: 'A kırmızı', value: s.a.red },
    aSari: { label: 'A sarı', value: s.a.yellow },
    aYesil: { label: 'A yeşil', value: s.a.green },
    bKirmizi: { label: 'B kırmızı', value: s.b.red },
    bSari: { label: 'B sarı', value: s.b.yellow },
    bYesil: { label: 'B yeşil', value: s.b.green },
    yayaKirmizi: { label: 'Yaya kırmızı', value: s.pedRed },
    yayaYesil: { label: 'Yaya yeşil', value: s.pedGreen },
    buton: { label: 'Yaya butonu (PB)', value: s.button },
    aGecen: { label: 'A yolundan geçen araç', value: s.a.passed },
    bGecen: { label: 'B yolundan geçen araç', value: s.b.passed },
    aBekleyen: { label: 'A yolunda bekleyen', value: s.a.waiting },
    bBekleyen: { label: 'B yolunda bekleyen', value: s.b.waiting },
    yayaBekleyen: { label: 'Bekleyen yaya', value: s.pedWaiting },
    yayaGecen: { label: 'Karşıya geçen yaya', value: s.pedPassed },
    catisma: { label: 'Çatışma (çakışan yeşiller)', value: s.conflicts },
    kaza: { label: 'Kaza riski (kavşakta karşılaşma)', value: s.crashes },
    tehlike: { label: 'Yaya tehlikesi', value: s.dangers },
  }),
});

// --- Butonlu yaya geçidi --------------------------------------------------------------------
//
// İki şeritli yol: doğuya giden (alt şerit) ve batıya giden (üst şerit) araçlar aynı araç
// ışığına uyar. Yayalar iki kaldırımdan gelir, butona basar ve yaya yeşilinde zebradan geçer.
// BEKLEYİN lambası butonun üstündedir (talebin alındığını yayaya gösterir). Şerit konumları
// iki yön için de aynıdır (görünüm batıya giden şeridi aynalar).

export const CROSSING = { stop: 0.4357, walkFrom: 0.464, walkTo: 0.536 };

const crossingSpec = {
  type: 'pedCrossing' as const,
  title: 'Butonlu yaya geçidi',
  prefix: 'H',
  category: 'Sahneler' as const,
  description:
    'İki yönlü yol üzerinde butonlu yaya geçidi. Sinyal girişleri (24 V DC, yük sayılmaz, PLC çıkışına doğrudan): ' +
    'araç ışığı R/Y/G, yaya ışığı PR/PG, BEKLEYİN lambası W. PB iki kaldırımdaki butonların ortak çıkışıdır ' +
    '(PNP, basılıyken +24 V). Kart L+ / M ile beslenir. Yaya yeşili araçlara yol verilirken yanarsa çatışma; yaya ' +
    'zebradayken araç geçerse yaya tehlikesi sayılır. Geçide tıklayınca yaya gelir ve butona basar.',
  terminals: ['L+', 'M', 'R', 'Y', 'G', 'PR', 'PG', 'W', 'PB'],
  params: [
    ...LANE_PARAMS(3),
    num('pedS', 'Yaya geliş aralığı (0 = elle)', 0, 0, 120, 1, 's'),
    num('walkS', 'Yayanın karşıya geçme süresi', 2.5, 0.5, 20, 0.5, 's'),
  ],
};

export const pedCrossingModule = defineModule({
  spec: crossingSpec,
  faults: [
    { key: 'red', label: 'Araç kırmızı LED yanık' },
    { key: 'green', label: 'Araç yeşil LED yanık' },
    { key: 'p-green', label: 'Yaya yeşil LED yanık' },
    { key: 'wait', label: 'BEKLEYİN lambası yanık' },
    { key: 'button', label: 'Yaya butonu arızalı (basınca sinyal yok)' },
  ],
  create: (inst) => {
    const p = paramReader(crossingSpec, inst);
    const arrival = p.num('arrivalS') * 1000;
    const speed = 1 / (p.num('crossS') * 1000);
    return {
      east: new Lane(CROSSING.stop, arrival, speed, 0.5),
      west: new Lane(CROSSING.stop, arrival * 1.3, speed, 0.2),
      peds: new Crowd(2, p.num('walkS') * 1000, p.num('pedS') * 1000),
      powered: false,
      head: { red: false, yellow: false, green: false } as Head,
      pedRed: false,
      pedGreen: false,
      wait: false,
      conflict: false,
      conflicts: 0,
      danger: false,
      dangers: 0,
    };
  },
  links: (d, net) => {
    if (d.powered && d.peds.pressMs > 0 && !net.fault('button')) net.source('PB', 'P24');
  },
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    d.head = headOf(io, d.powered, 'R', 'Y', 'G');
    d.pedRed = d.powered && io.high('PR');
    d.pedGreen = d.powered && io.high('PG') && !io.fault('p-green');
    d.wait = d.powered && io.high('W') && !io.fault('wait');

    const conflict = invalid(d.head) || (d.pedGreen && (d.pedRed || open(d.head)));
    if (conflict && !d.conflict) {
      d.conflicts++;
      io.event('yaya geçidi: yaya yeşili araçlara yol verilirken yanıyor!');
    }
    d.conflict = conflict;

    d.peds.update(d.pedGreen && !d.pedRed, dt);
    d.east.update(d.head, dt);
    d.west.update(d.head, dt);

    const onZebra = (l: Lane) => l.occupied(CROSSING.walkFrom, CROSSING.walkTo, true);
    const danger = d.peds.onCrossing && (onZebra(d.east) || onZebra(d.west));
    if (danger && !d.danger) {
      d.dangers++;
      io.event('yaya geçidi: yaya zebradayken araç geçti!');
    }
    d.danger = danger;
  },
  command: (d, action, _v, io) => {
    if (action === 'pedestrian') {
      if (!d.peds.arrive()) io.event('geçitte bekleyen yaya çok');
    } else if (action === 'press') {
      d.peds.pressMs = PRESS_MS;
    } else if (action === 'car' && !d.east.add()) io.event('yolun başında yer yok');
  },
  state: (d) => ({
    type: 'pedCrossing' as const,
    powered: d.powered,
    ...d.head,
    east: d.east.view(),
    west: d.west.view(),
    carLength: CAR,
    pedRed: d.pedRed,
    pedGreen: d.pedGreen,
    wait: d.wait,
    /** Kaldırımda bekleyen yaya: [üst, alt]. */
    pedWaiting: [...d.peds.waiting],
    walkers: d.peds.walkers.map((p) => ({ ...p })),
    pedPassed: d.peds.passed,
    button: d.peds.pressMs > 0,
    conflict: d.conflict,
    conflicts: d.conflicts,
    danger: d.danger,
    dangers: d.dangers,
  }),
  signals: (s) => ({
    kirmizi: { label: 'Araç kırmızı', value: s.red },
    sari: { label: 'Araç sarı', value: s.yellow },
    yesil: { label: 'Araç yeşil', value: s.green },
    yayaKirmizi: { label: 'Yaya kırmızı', value: s.pedRed },
    yayaYesil: { label: 'Yaya yeşil', value: s.pedGreen },
    bekleyin: { label: 'BEKLEYİN lambası', value: s.wait },
    buton: { label: 'Yaya butonu (PB)', value: s.button },
    gecen: { label: 'Geçen araç', value: s.east.passed + s.west.passed },
    bekleyen: { label: 'Bekleyen araç', value: s.east.waiting + s.west.waiting },
    yayaBekleyen: { label: 'Bekleyen yaya', value: s.pedWaiting[0]! + s.pedWaiting[1]! },
    yayaGecen: { label: 'Karşıya geçen yaya', value: s.pedPassed },
    catisma: { label: 'Çatışma (yaya yeşili + araç yolu açık)', value: s.conflicts },
    tehlike: { label: 'Yaya tehlikesi', value: s.dangers },
  }),
});
