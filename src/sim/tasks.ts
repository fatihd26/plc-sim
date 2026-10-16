// Hazır görevler: kablolaması yapılmış bir şema, boş PLC programı, görev metni ve otomatik
// denetim senaryosu. Öğrenci ladder programını yazar, "Kontrol et" ile senaryoyu koşturur.
// Her görevin çözümü ilgili örnek projedir (tasks.test.ts çözümün senaryoyu geçtiğini denetler).

import { lampRelaySolution, reversingSolution, reversingStarter, sealRelaySolution, withoutWires } from './basics';
import { conveyorSchematic, fanSchematic, type Example } from './examples';
import {
  elevatorSchematic,
  garageDoorSchematic,
  pickPlaceSchematic,
  pidTankSchematic,
  starDeltaSchematic,
  pedCrossingSchematic,
  trafficJunctionSchematic,
  trafficLightSchematic,
} from './examplesLib';
import type { Schematic, Task } from './schematic';

export interface TaskDef {
  id: string;
  title: string;
  /** Kısa açıklama (menüde). */
  summary: string;
  task: Task;
  /** Çözümü içeren şema (programlı). */
  solution(): Schematic;
  /** Öğrencinin başladığı şema; yoksa çözümün programı boşaltılmış hâli (PLC'siz görevlerde kablosuz). */
  starter?(): Schematic;
}

/** Çözüm şemasından görev şeması: PLC programları boşaltılır, görev eklenir. */
export function taskSchematic(def: TaskDef): Schematic {
  const s = def.starter ? def.starter() : def.solution();
  s.title = `Görev: ${def.title}`;
  s.task = structuredClone(def.task);
  for (const c of s.components) if (c.type === 'plc' || c.type === 'esp32') c.program = { networks: [] };
  return s;
}

const lines = (...l: string[]) => l.join('\n');

export const TASKS: TaskDef[] = [
  {
    id: 'task-lamp-relay',
    title: 'Lamba yakma (röle ile)',
    summary: 'PLC yok: S1 basılıyken K1 rölesi çeksin, rölenin kontağı P1 lambasını yaksın.',
    solution: lampRelaySolution,
    starter: () => withoutWires(lampRelaySolution()),
    task: {
      title: 'Lamba yakma (röle ile)',
      text: lines(
        'Elemanlar yerleştirildi, kabloları sen bağlayacaksın.',
        'S1 basılıyken K1 rölesinin bobini (A1-A2) G1 24 V ile beslensin.',
        "K1'in 13-14 kontağı P1 lambasını yaksın. S1 bırakılınca lamba sönmeli.",
      ),
      scenario: lines(
        'kontrol değil P1.yanik',
        'bas S1',
        'bekle K1.kontak en fazla 1 s',
        'kontrol P1.yanik boyunca 500 ms',
        'bırak S1',
        'bekle değil P1.yanik en fazla 1 s',
      ),
    },
  },
  {
    id: 'task-seal-relay',
    title: 'Röle ile start-stop',
    summary: 'PLC yok: S1 start, S2 stop; K1 rölesi kendi kontağıyla mühürlensin.',
    solution: sealRelaySolution,
    starter: () => withoutWires(sealRelaySolution()),
    task: {
      title: 'Röle ile start-stop (mühürleme)',
      text: lines(
        'S1 (NO) start, S2 (NC) stop. S1 bırakılınca K1 çekili kalmalı (mühürleme), S2 basılınca bırakmalı.',
        "Mühür için K1'in bir NO kontağını S1'e paralel bağla; lambayı diğer NO kontağıyla yak.",
      ),
      scenario: lines(
        'tıkla S1',
        'bekle K1.kontak en fazla 1 s',
        'kontrol P1.yanik boyunca 1 s',
        'tıkla S2',
        'bekle değil P1.yanik en fazla 1 s',
        'kontrol değil K1.kontak boyunca 500 ms',
      ),
    },
  },
  {
    id: 'task-reversing',
    title: 'Kilitlemeli ileri-geri motor',
    summary: 'PLC yok: S1 ileri, S2 geri, S0 stop; K1 ve K2 asla birlikte çekmesin.',
    solution: reversingSolution,
    starter: reversingStarter,
    task: {
      title: 'Kilitlemeli ileri-geri motor',
      text: lines(
        'Güç devresi hazır: K1 ileri, K2 geri (iki faz yer değiştirir). Kumanda devresini sen kur.',
        'S1 (NO) ileri, S2 (NO) geri, S0 (NC) stop. Her kontaktör kendi 13-14 kontağıyla mühürlensin.',
        "Biri çekiliyken diğeri çekmemeli: karşı kontaktörün 21-22 NC kontağını bobinin önüne koy. Termik (95-96) hepsini kessin.",
      ),
      scenario: lines(
        'tıkla S1',
        'bekle K1.kontak en fazla 1 s',
        'kontrol M1.calisiyor ve değil K2.kontak',
        '# İleri dönerken geriye basmak işe yaramamalı',
        'bas S2',
        'kontrol değil K2.kontak boyunca 500 ms',
        'bırak S2',
        'kontrol K1.kontak',
        'tıkla S0',
        'bekle değil K1.kontak en fazla 1 s',
        'tıkla S2',
        'bekle K2.kontak en fazla 1 s',
        'kontrol M1.calisiyor ve değil K1.kontak boyunca 500 ms',
        'tıkla S0',
        'bekle değil K2.kontak en fazla 1 s',
      ),
    },
  },
  {
    id: 'task-fan',
    title: 'Fan start-stop',
    summary: 'Mühürleme devresi: start ile çalışsın, stop ile dursun.',
    solution: fanSchematic,
    task: {
      title: 'Fan start-stop (mühürleme)',
      text: lines(
        'S1 (start, %I0.0) butonuna basılıp bırakılınca fan E1 çalışmaya devam etmeli.',
        'S2 (stop, NC, %I0.1) basılınca fan durmalı.',
        'Fan, K1 rölesi (%Q0.0) üzerinden beslenir.',
      ),
      scenario: lines(
        '# Start: fan çalışmalı ve buton bırakılınca çalışmaya devam etmeli',
        'tıkla S1',
        'bekle E1.calisiyor en fazla 1 s',
        'kontrol E1.calisiyor boyunca 2 s',
        '# Stop: fan durmalı',
        'tıkla S2',
        'kontrol değil E1.calisiyor',
        'kontrol değil E1.calisiyor boyunca 1 s',
      ),
    },
  },
  {
    id: 'task-conveyor',
    title: 'Konveyör: fotoselde dur',
    summary: 'Kutu fotosele gelince bant dursun, lamba yansın; start kutuyu göndersin.',
    solution: conveyorSchematic,
    task: {
      title: 'Konveyör: kutu fotosele gelince dur',
      text: lines(
        'S1 (%I0.0) ile bant (K1, %Q0.0) çalışsın, S2 (%I0.1, NC) durdursun; termik (%I0.2) atınca dursun.',
        'Kutu bant sonundaki fotosele (%I0.3) gelince bant dursun ve P1 lambası (K2, %Q0.1) yansın.',
        "Kutu fotoseldeyken S1 basılı tutulursa kutu gönderilsin; kutu fotoseli geçince bant çalışmaya devam etsin.",
      ),
      scenario: lines(
        'tıkla S1',
        'bekle M1.calisiyor en fazla 1 s',
        'bekle M1.fotosel en fazla 15 s',
        'bekle 300 ms',
        'kontrol değil M1.calisiyor',
        'kontrol P1.yanik',
        'bas S1',
        'bekle değil M1.fotosel en fazla 5 s',
        'bırak S1',
        'kontrol M1.calisiyor boyunca 200 ms',
        'tıkla S2',
        'kontrol değil M1.calisiyor',
      ),
    },
  },
  {
    id: 'task-traffic',
    title: 'Trafik ışığı',
    summary: 'Kırmızı 5 s, yeşil 5 s, sarı 2 s; döngü hiç durmasın, yeşil başka renkle birlikte yanmasın.',
    solution: trafficLightSchematic,
    task: {
      title: 'Trafik ışığı',
      text: lines(
        'Sinyal kafası H1: kırmızı %Q0.0, sarı %Q0.1, yeşil %Q0.2. Kablolar hazır, programı sen yazacaksın.',
        'PLC çalışınca kırmızı 5 s yansın, sonra yeşil 5 s, sonra sarı 2 s; ardından tekrar kırmızı ve döngü sürsün.',
        'Her an tek renk yanmalı. Yeşil, kırmızı veya sarıyla birlikte yanarsa sahnede ÇATIŞMA uyarısı çıkar.',
        'Araçları izle: yeşilde geçmeli, kırmızıda durma çizgisinde beklemeli.',
      ),
      scenario: lines(
        'bekle 300 ms',
        'kontrol H1.kirmizi ve değil H1.sari ve değil H1.yesil',
        '# Kırmızı yaklaşık 5 s sürmeli',
        'kontrol H1.kirmizi boyunca 4 s',
        'bekle H1.yesil en fazla 1500 ms',
        'kontrol değil H1.kirmizi ve değil H1.sari',
        'kontrol H1.yesil boyunca 4500 ms',
        'bekle H1.sari en fazla 1 s',
        'kontrol değil H1.yesil ve değil H1.kirmizi',
        'kontrol H1.sari boyunca 1500 ms',
        'bekle H1.kirmizi ve değil H1.sari en fazla 1 s',
        '# Araçlar yeşilde geçmiş olmalı; döngü ikinci kez yeşile dönmeli',
        'kontrol H1.gecen >= 1',
        'bekle H1.yesil en fazla 6 s',
        'kontrol H1.catisma = 0',
      ),
    },
  },
  {
    id: 'task-star-delta',
    title: 'Yıldız-üçgen yol verme',
    summary: 'Önce yıldız, 4 s sonra üçgen; K2 ve K3 asla birlikte çekmesin.',
    solution: starDeltaSchematic,
    task: {
      title: 'Yıldız-üçgen yol verme',
      text: lines(
        'S1 (%I0.0) ile K1 ana (%Q0.0) ve K2 yıldız (%Q0.1) kontaktörleri çeksin.',
        '4 s sonra K2 bıraksın, K3 üçgen (%Q0.2) çeksin. K2 ve K3 aynı anda çekmemeli (kilitleme).',
        'S2 (%I0.1, NC) veya termik (%I0.2) hepsini bıraksın.',
      ),
      scenario: lines(
        'tıkla S1',
        'bekle 300 ms',
        'kontrol M1.yildiz',
        'kontrol K1.kontak ve K2.kontak ve değil K3.kontak',
        'bekle M1.ucgen en fazla 6 s',
        'kontrol değil K2.kontak',
        'kontrol M1.ucgen boyunca 2 s',
        'tıkla S2',
        'kontrol değil M1.calisiyor',
      ),
    },
  },
  {
    id: 'task-crossing',
    title: 'Butonlu yaya geçidi',
    summary: 'Araçlar yeşilde; yaya butona basınca BEKLEYİN yansın, sonra güvenli bir sırayla yayaya yol ver.',
    solution: pedCrossingSchematic,
    task: {
      title: 'Butonlu yaya geçidi',
      text: lines(
        'H1 geçidi: araç ışığı %Q0.0..2 (kırmızı, sarı, yeşil), yaya ışığı %Q0.3 kırmızı / %Q0.4 yeşil, BEKLEYİN lambası %Q0.5. Yaya butonu PB → %I0.0.',
        'Normalde araç yeşil, yaya kırmızı. Butona basılınca talep hafızada kalsın (Set) ve BEKLEYİN yansın.',
        'Araç yeşili en az 5 s sürmüş olmalı. Sonra: araç sarı 2 s → tüm kırmızı 1 s → yaya yeşil 5 s → temizleme 3 s (iki ışık da kırmızı) → araç yeşil.',
        'Yaya yeşili yanınca BEKLEYİN sönsün. Temizleme süresi, son yayanın karşıya varması içindir: yaya zebradayken araç geçerse YAYA TEHLİKEDE uyarısı çıkar.',
      ),
      scenario: lines(
        'bekle 300 ms',
        'kontrol H1.yesil ve H1.yayaKirmizi ve değil H1.bekleyin',
        '# Talep yokken araç yeşili sürer',
        'kontrol H1.yesil ve değil H1.yayaYesil boyunca 6 s',
        'eylem H1 pedestrian',
        'bekle H1.bekleyin en fazla 500 ms',
        'bekle H1.sari en fazla 1 s',
        'kontrol değil H1.yesil ve değil H1.yayaYesil',
        'bekle H1.kirmizi en fazla 3 s',
        '# Tüm kırmızı: yaya hemen yeşil almamalı',
        'kontrol değil H1.yayaYesil boyunca 500 ms',
        'bekle H1.yayaYesil en fazla 2 s',
        'kontrol H1.kirmizi ve değil H1.bekleyin',
        'bekle H1.yayaGecen >= 1 en fazla 5 s',
        'bekle değil H1.yayaYesil en fazla 5 s',
        '# Temizleme: araçlar hâlâ kırmızıda',
        'kontrol H1.kirmizi ve değil H1.yesil boyunca 2 s',
        'bekle H1.yesil en fazla 3 s',
        '# Hemen basılan buton: araç yeşili en az 5 s sürmeli',
        'eylem H1 pedestrian',
        'bekle H1.bekleyin en fazla 500 ms',
        'kontrol H1.yesil ve H1.bekleyin boyunca 3 s',
        'bekle H1.yayaYesil en fazla 12 s',
        'bekle H1.yesil en fazla 15 s',
        'kontrol H1.tehlike = 0 ve H1.catisma = 0 ve H1.yayaGecen >= 2 ve H1.gecen >= 1',
      ),
    },
  },
  {
    id: 'task-junction',
    title: 'Kavşak ve yaya geçidi',
    summary: 'İki yola sırayla yol ver, arada tüm kırmızı bırak; yaya butona basınca güvenle geçsin.',
    solution: trafficJunctionSchematic,
    task: {
      title: 'Kavşak ve yaya geçidi',
      text: lines(
        'H1 kavşağı: A ışığı %Q0.0..2 (kırmızı, sarı, yeşil), B ışığı %Q0.3..5, yaya ışığı %Q0.6 kırmızı / %Q0.7 yeşil. Yaya butonu PB → %I0.0.',
        'Döngü: A yeşil 6 s → A sarı 2 s → tüm kırmızı 1 s → B yeşil 4 s → B sarı 2 s → tüm kırmızı 1 s → baştan.',
        'Yaya butona basınca talep hafızada kalsın (Set). Talep varsa yaya, A kırmızıyken (B yeşiliyle birlikte) yeşil yansın; talep yoksa yaya kırmızı kalsın.',
        'Sahneyi izle: çakışan yeşiller ÇATIŞMA, kavşakta karşılaşan araçlar KAZA RİSKİ, geçitteki yayaya araç gelmesi YAYA TEHLİKEDE uyarısı verir.',
      ),
      scenario: lines(
        'bekle 300 ms',
        'kontrol H1.aYesil ve H1.bKirmizi ve H1.yayaKirmizi ve değil H1.yayaYesil',
        'kontrol H1.aYesil ve değil H1.bYesil ve değil H1.bSari boyunca 5 s',
        'bekle H1.aSari en fazla 2 s',
        'kontrol değil H1.aYesil ve H1.bKirmizi',
        'bekle H1.aKirmizi en fazla 3 s',
        '# Tüm kırmızı: B hemen yeşile geçmemeli',
        'kontrol H1.bKirmizi ve değil H1.bYesil boyunca 500 ms',
        'bekle H1.bYesil en fazla 2 s',
        'kontrol H1.aKirmizi ve değil H1.aSari',
        '# Kimse butona basmadı: yaya kırmızı kalmalı',
        'kontrol H1.yayaKirmizi ve değil H1.yayaYesil boyunca 3 s',
        'bekle H1.bSari en fazla 2 s',
        'bekle H1.aYesil en fazla 4 s',
        '# Yaya gelir ve butona basar',
        'eylem H1 pedestrian',
        'bekle H1.yayaYesil en fazla 12 s',
        'kontrol H1.aKirmizi ve değil H1.aSari',
        'bekle H1.yayaGecen >= 1 en fazla 5 s',
        'bekle H1.aYesil en fazla 8 s',
        'kontrol H1.catisma = 0 ve H1.kaza = 0 ve H1.tehlike = 0',
        'kontrol H1.aGecen >= 1 ve H1.bGecen >= 1',
      ),
    },
  },
  {
    id: 'task-elevator',
    title: 'Asansör: 3 kat',
    summary: 'Çağrılan kata git, katta dur; yön kontaktörleri kilitli olsun.',
    solution: elevatorSchematic,
    task: {
      title: 'Asansör (3 kat)',
      text: lines(
        'Kat çağrı butonları S1, S2, S3 (%I0.0..2); kat sensörleri F1, F2, F3 (%I0.3..5).',
        'K1 (%Q0.0) yukarı, K2 (%Q0.1) aşağı. Kabin çağrılan kata gitmeli ve orada durmalı.',
        'K1 ve K2 asla birlikte çekmemeli.',
      ),
      scenario: lines(
        'bekle 200 ms',
        'kontrol M1.f1',
        'tıkla S3',
        'bekle M1.f3 ve değil K1.kontak en fazla 15 s',
        'kontrol M1.kat >= 2.95 ve M1.kat <= 3.05',
        'tıkla S2',
        'bekle M1.f2 ve değil K2.kontak en fazla 10 s',
        'kontrol M1.kat >= 1.95 ve M1.kat <= 2.05',
        'tıkla S1',
        'bekle M1.f1 ve değil K2.kontak en fazla 10 s',
        'kontrol değil M1.calisiyor boyunca 1 s',
      ),
    },
  },
  {
    id: 'task-garage',
    title: 'Garaj kapısı',
    summary: 'Aç/kapat, sınır sensörleri ve kapanırken engelde geri açma.',
    solution: garageDoorSchematic,
    task: {
      title: 'Garaj kapısı',
      text: lines(
        'S1 (%I0.0) aç, S2 (%I0.1) kapat. LSO (%I0.2) tam açık, LSC (%I0.3) tam kapalı.',
        'K1 (%Q0.0) açar, K2 (%Q0.1) kapatır; kapı sınır sensöründe kendiliğinden durmalı.',
        'Kapanırken fotosel (PH, %I0.4; ışın kesilince 0) engel görürse kapı tamamen geri açılmalı.',
      ),
      scenario: lines(
        'tıkla S1',
        'bekle M1.acik en fazla 10 s',
        'bekle 300 ms',
        'kontrol değil K1.kontak',
        'tıkla S2',
        'bekle 2 s',
        'eylem M1 obstacle',
        'bekle M1.acik en fazla 10 s',
        'kontrol M1.carpma = 0',
        'eylem M1 obstacle',
        'tıkla S2',
        'bekle M1.kapali en fazla 10 s',
      ),
    },
  },
  {
    id: 'task-pid',
    title: 'PID seviye kontrolü',
    summary: 'Seviyeyi potansiyometredeki set değerinde tut; tüketim değişse de.',
    solution: pidTankSchematic,
    task: {
      title: 'PID seviye kontrolü',
      text: lines(
        'LT1 seviye transmitteri %IW0 (0..27648 = %0..100), R1 set potansiyometresi %IW1.',
        'Oransal giriş vanası %QW0 ile sürülür (0..27648 = kapalı..tam açık).',
        'PID kutusuyla seviyeyi set değerinde tutun: tüketim artınca ve set değeri değişince de ±%5 içinde kalmalı.',
      ),
      scenario: lines(
        'bekle 100 s',
        'kontrol T1.seviye >= 45 ve T1.seviye <= 55',
        'eylem T1 demand 60',
        'bekle 100 s',
        'kontrol T1.seviye >= 45 ve T1.seviye <= 55',
        'eylem R1 set 80',
        'bekle 100 s',
        'kontrol T1.seviye >= 75 ve T1.seviye <= 85',
      ),
    },
  },
  {
    id: 'task-pick-place',
    title: 'Pick & place çevrimi',
    summary: 'Parçaları çarpışmadan ve düşürmeden yerleştir.',
    solution: pickPlaceSchematic,
    task: {
      title: 'Pick & place çevrimi',
      text: lines(
        'Sensörler: X0, X1, Z0, Z1, GP (parça tutucuda), PS (alma noktasında parça) → %I0.0..5.',
        'Röleler: K1 X yerleştirmeye (%Q0.0), K2 Z aşağı (%Q0.1), K3 tutucu (%Q0.2).',
        'Gelen her parçayı kutuya koyun. Z aşağıdayken X hareket etmemeli, parça yolda bırakılmamalı.',
      ),
      scenario: lines('bekle U1.yerlestirilen >= 3 en fazla 40 s', 'kontrol U1.dusen = 0 ve U1.carpisma = 0'),
    },
  },
];

/** Örnek menüsündeki "Görevler" grubu. */
export const TASK_EXAMPLES: Example[] = TASKS.map((t) => ({
  id: t.id,
  group: 'Görevler',
  title: `Görev: ${t.title}`,
  description: `${t.summary} Program boş başlar; alt paneldeki "Görev" sekmesinden "Kontrol et" ile denetleyin.`,
  build: () => taskSchematic(t),
}));
