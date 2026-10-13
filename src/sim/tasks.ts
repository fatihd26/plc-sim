// Hazır görevler: kablolaması yapılmış bir şema, boş PLC programı, görev metni ve otomatik
// denetim senaryosu. Öğrenci ladder programını yazar, "Kontrol et" ile senaryoyu koşturur.
// Her görevin çözümü ilgili örnek projedir (tasks.test.ts çözümün senaryoyu geçtiğini denetler).

import { conveyorSchematic, fanSchematic, type Example } from './examples';
import {
  elevatorSchematic,
  garageDoorSchematic,
  pickPlaceSchematic,
  pidTankSchematic,
  starDeltaSchematic,
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
}

/** Çözüm şemasından görev şeması: PLC programları boşaltılır, görev eklenir. */
export function taskSchematic(def: TaskDef): Schematic {
  const s = def.solution();
  s.title = `Görev: ${def.title}`;
  s.task = structuredClone(def.task);
  for (const c of s.components) if (c.type === 'plc' || c.type === 'esp32') c.program = { networks: [] };
  return s;
}

const lines = (...l: string[]) => l.join('\n');

export const TASKS: TaskDef[] = [
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
