// Eğitim yolu: 5 seviye; her seviye ders ve görevlerden oluşur, son görev çıkış senaryosudur.
// Ders adım adım ilerler; bir adımın `done` koşulu varsa öğrenci onu yapınca adım tamamlanır
// (canlı simülasyon veya şema üzerinden denetlenir). Görevler tasks.ts'teki hazır görevlerdir.
// Henüz yazılmamış dersler ve görevler `soon` olarak listelenir (idea.md › Seviye planı).

import { contactsLesson, circuitLesson, lampRelaySolution, protectionLesson } from '../sim/basics';
import { fanSchematic, startStopSchematic, timerCounterSchematic } from '../sim/examples';
import type { CoilType } from '../sim/ladder';
import { evalCondition } from '../sim/scenario';
import type { Schematic } from '../sim/schematic';
import type { SimSnapshot } from '../sim/simulation';

/** Adım denetimlerinin okuduğu uygulama durumu. */
export interface StepContext {
  schematic: Schematic;
  snapshot: SimSnapshot | null;
  mode: 'edit' | 'sim';
  running: boolean;
  /** Alt PLC paneli açık mı. */
  plcOpen: boolean;
}

export interface Step {
  text: string;
  /** Öğrencinin yapacağı iş (kısa); `done` varsa adım bu yapılınca tamamlanır. */
  todo?: string;
  done?(ctx: StepContext): boolean;
}

export interface Lesson {
  kind: 'lesson';
  id: string;
  title: string;
  minutes: number;
  /** Ders açılınca yüklenen şema. */
  build?(): Schematic;
  steps: Step[];
}

export interface TaskItem {
  kind: 'task';
  id: string;
  /** tasks.ts'teki görev kimliği. */
  taskId: string;
  title: string;
  /** Seviyenin çıkış senaryosu. */
  exit?: boolean;
  /** Görev kartında gösterilen yön. */
  hint: string;
}

export interface SoonItem {
  kind: 'soon';
  id: string;
  title: string;
  what: 'ders' | 'görev';
  exit?: boolean;
}

export type Item = Lesson | TaskItem | SoonItem;

export interface Level {
  id: string;
  title: string;
  topic: string;
  /** Çıkış kriteri: bu seviyeyi bitiren ne yapabilir. */
  goal: string;
  items: Item[];
}

// --- Adım denetimleri ------------------------------------------------------------------------

const inSim = (c: StepContext) => c.mode === 'sim';
const running = (c: StepContext) => c.mode === 'sim' && c.running;
const plcOpen = (c: StepContext) => c.plcOpen;
const paused = (c: StepContext) => c.mode === 'sim' && !c.running && !!c.snapshot && c.snapshot.timeMs > 0;
/** Senaryo dilindeki koşul canlı simülasyonda sağlanıyor mu (ör. "P1.yanik ve değil S1.basili"). */
const sig = (cond: string) => (c: StepContext) => !!c.snapshot && evalCondition(c.schematic, c.snapshot, cond);
const param = (name: string, key: string, ok: (v: number) => boolean) => (c: StepContext) => {
  const v = c.schematic.components.find((x) => x.name === name)?.params?.[key];
  return typeof v === 'number' && ok(v);
};
/** Şemadaki ilk PLC programında `address` adresli, `type` türünde kutunun ön ayarı `ok` mu. */
const preset = (address: string, type: CoilType, ok: (v: number) => boolean) => (c: StepContext) =>
  c.schematic.components.some((x) =>
    x.program?.networks.some((n) => n.coil.address === address && n.coil.type === type && typeof n.coil.preset === 'number' && ok(n.coil.preset)),
  );
const all =
  (...fs: ((c: StepContext) => boolean)[]) =>
  (c: StepContext) =>
    fs.every((f) => f(c));

const START_SIM: Step = {
  text: 'Üstteki ▶ Simülasyon sekmesine geç ve şeritteki Başlat düğmesine bas (kısayol: F5, sonra Boşluk).',
  todo: 'Simülasyonu başlat',
  done: running,
};

/** Fan şeması, PLC programı boş. */
function fanEmpty(): Schematic {
  const s = fanSchematic();
  s.title = 'Ders: Set / Reset';
  for (const c of s.components) if (c.type === 'plc') c.program = { networks: [] };
  return s;
}

// --- Seviyeler -------------------------------------------------------------------------------

export const LEVELS: Level[] = [
  {
    id: 'baslangic',
    title: 'Başlangıç',
    topic: 'Elektrik ve röle mantığı',
    goal: 'PLC kullanmadan buton, röle ve kontaktörle kilitlemeli bir ileri-geri motor kumandası kurabilirsin.',
    items: [
      {
        kind: 'lesson',
        id: 'b-devre',
        title: 'Devre ve potansiyel',
        minutes: 5,
        build: circuitLesson,
        steps: [
          {
            text: 'Bir devrede akım, kaynağın + ucundan çıkıp yükten geçerek – ucuna döner. Bu şemada G1 24 V DC güç kaynağı, P1 ise bir sinyal lambası. G1\'in L+ ucu +24 V, M ucu 0 V.',
          },
          START_SIM,
          {
            text: 'Lamba yanıyor. Kabloların rengine bak: kırmızı +24 V, mavi 0 V potansiyelinde. Lambanın iki ucu arasında 24 V fark var, bu yüzden akım geçiyor.',
            todo: 'P1 yansın',
            done: sig('P1.yanik'),
          },
          {
            text: 'Şimdi devreyi aç: ✎ Düzenle moduna dön, P1 ile G1:M arasındaki kabloya tıkla ve Del ile sil. Sonra simülasyonu tekrar başlat.',
            todo: 'Kabloyu sil, simülasyonda lambanın söndüğünü gör',
            done: all(running, sig('değil P1.yanik')),
          },
          {
            text: 'Lamba yanmıyor: akımın dönüş yolu yok, devre kapanmadı. Arıza bulmanın ilk kuralı budur: yük çalışmıyorsa önce devrenin kapalı olup olmadığına bak. Kabloyu geri almak için Düzenle modunda Ctrl+Z.',
          },
        ],
      },
      {
        kind: 'lesson',
        id: 'b-kontak',
        title: 'NO / NC kontak, buton, lamba',
        minutes: 6,
        build: contactsLesson,
        steps: [
          {
            text: 'S1 bir NO (normalde açık) buton: basılınca kontağı kapanır. S2 bir NC (normalde kapalı) buton: basılınca kontağı açılır. S1 P1\'i, S2 P2\'yi besliyor.',
          },
          START_SIM,
          {
            text: 'Hiçbir şeye basmadan bak: P2 yanıyor, P1 sönük. NC kontak dinlenmede iletir.',
            todo: 'P2 yanık, P1 sönük',
            done: sig('P2.yanik ve değil P1.yanik'),
          },
          {
            text: 'S1\'in üzerine fareyle basılı tut (dokunmatikte parmakla basılı tut).',
            todo: 'S1 basılıyken P1 yansın',
            done: sig('S1.basili ve P1.yanik'),
          },
          {
            text: 'Şimdi S2\'ye basılı tut: NC kontak açılır, P2 söner.',
            todo: 'S2 basılıyken P2 sönsün',
            done: sig('S2.basili ve değil P2.yanik'),
          },
          {
            text: 'Kural: start butonları NO, stop ve acil stop butonları NC seçilir. Stop kablosu koparsa NC kontak "bas" sinyali verir ve makine durur; yani arıza güvenli tarafa düşer.',
          },
        ],
      },
      {
        kind: 'task',
        id: 'b-g-lamba',
        taskId: 'task-lamp-relay',
        title: 'Lamba yakma (röle ile)',
        hint: 'Kablo çizmek için bir terminalden diğerine sürükle. Bobin devresi: G1:L+ → S1 → K1:A1, K1:A2 → G1:M. Yük devresi: G1:L+ → K1:13, K1:14 → P1 → G1:M.',
      },
      {
        kind: 'lesson',
        id: 'b-role',
        title: 'Röle ve mühürleme',
        minutes: 8,
        build: lampRelaySolution,
        steps: [
          {
            text: 'K1 bir röle: bobini (A1-A2) enerjilenince kontakları konum değiştirir. Butonun küçük akımı bobini, rölenin kontağı da yükü anahtarlar. Bu devre bir önceki görevin çözümü.',
          },
          START_SIM,
          {
            text: 'S1\'e basılı tut: K1 çeker, 13-14 kontağı kapanır, P1 yanar.',
            todo: 'S1 basılıyken K1 çeksin',
            done: sig('S1.basili ve K1.kontak ve P1.yanik'),
          },
          {
            text: 'Mühürleme: rölenin kendi kontağıyla kendini beslemesi. Düzenle moduna dön ve iki kablo ekle: G1:L+ → K1:23 ve K1:24 → K1:A1. Böylece 23-24 kontağı S1\'e paralel olur. Sonra simülasyonda S1\'e bir kez basıp bırak.',
            todo: 'S1 bırakıldığında P1 yanık kalsın',
            done: sig('P1.yanik ve değil S1.basili'),
          },
          {
            text: 'Lamba artık sönmüyor: K1 çekili kaldıkça kendi kontağı bobini besliyor. Söndürmek için bu yolu kesen bir stop (NC) butonu gerekir. Sıradaki görevde onu ekleyeceksin.',
          },
        ],
      },
      {
        kind: 'task',
        id: 'b-g-muhur',
        taskId: 'task-seal-relay',
        title: 'Röle ile start-stop',
        hint: 'Stop (S2, NC) beslemenin en başına: G1:L+ → S2:11. S2:12\'den sonra S1 ve mühür kontağı (K1:13-14) paralel olarak K1:A1\'e gider. Lamba K1:23-24 üzerinden.',
      },
      {
        kind: 'lesson',
        id: 'b-koruma',
        title: 'Koruma: termik röle',
        minutes: 7,
        build: protectionLesson,
        steps: [
          {
            text: 'Kontaktör (K1) motor gibi büyük yükleri anahtarlar. Termik röle (F2) motor akımını izler: akım uzun süre ayarın üstünde kalırsa açar ve 95-96 NC kontağı kumanda devresini keser. Bu devrede F2:95-96 stop butonunun önünde.',
          },
          START_SIM,
          {
            text: 'S1\'e bir kez bas: K1 mühürlenir, motor döner.',
            todo: 'M1 çalışsın',
            done: sig('M1.calisiyor'),
          },
          {
            text: 'Motoru zorlayalım: ✎ Düzenle moduna dön, M1\'e tıkla ve sağdaki Özellikler panelinde Yük değerini %300 yap.',
            todo: 'M1 yükü en az %200',
            done: param('M1', 'loadPct', (v) => v >= 200),
          },
          {
            text: 'Simülasyonu başlat, S1\'e bas ve birkaç saniye bekle. Aşırı akım F2\'yi ısıtır, F2 atar, 95-96 açılır ve K1 bırakır.',
            todo: 'F2 atsın, K1 bıraksın',
            done: sig('F2.atti ve değil K1.kontak'),
          },
          {
            text: 'Termik attığında motor kendiliğinden yeniden kalkmaz: önce sebep giderilir (aşırı yük), sonra termik resetlenir ve start\'a basılır. Sigorta ve motor koruma şalteri ise kısa devrede anında açar.',
          },
        ],
      },
      {
        kind: 'task',
        id: 'b-g-ileri-geri',
        taskId: 'task-reversing',
        title: 'Kilitlemeli ileri-geri motor',
        exit: true,
        hint: 'Her yön bir start-stop devresi: S0:12 → S1 (paralel K1:13-14) → K2:21-22 → K1:A1. Geri yön aynısı, K2 ve K1:21-22 ile. Beslemenin başına termik: G1:L+ → F2:95, F2:96 → S0:11.',
      },
    ],
  },
  {
    id: 'temel',
    title: 'Temel',
    topic: 'PLC\'ye giriş ve komutlar',
    goal: 'PLC giriş ve çıkışlarını bağlayıp mühürleme, set/reset, zamanlayıcı ve sayıcı kullanan ladder programları yazabilirsin.',
    items: [
      {
        kind: 'lesson',
        id: 't-plc',
        title: 'PLC nedir, scan cycle, %I / %Q',
        minutes: 8,
        build: startStopSchematic,
        steps: [
          {
            text: 'Bu devrede motoru röle mantığı değil PLC (A1) kumanda eder. S1, S2 ve termik kontağı PLC girişlerine (%I0.0, %I0.1, %I0.2), K1 bobini PLC çıkışına (%Q0.0) bağlı. Kumanda mantığı artık kabloda değil, programda.',
          },
          {
            text: 'Programı görmek için şeritteki ▤ PLC paneli düğmesine bas. Alttaki Program sekmesinde ladder var: %I0.0 ile %Q0.0 paralel (mühür), %I0.1 seri (stop).',
            todo: 'PLC panelini aç',
            done: plcOpen,
          },
          START_SIM,
          {
            text: 'S1\'e bas: motor döner. Alttaki Online izlemede iletken kontaklar yeşile döner, I/O tablosunda %I0.0 ve %Q0.0\'ı izle.',
            todo: 'M1 çalışsın',
            done: sig('M1.calisiyor'),
          },
          {
            text: 'Scan cycle: PLC durmadan şu döngüyü yapar: girişleri oku → programı yukarıdan aşağı çalıştır → çıkışları yaz. Üst çubukta scan sayısı ve süresi görünüyor. Şeritte Duraklat\'a bas, sonra "1 scan" ile tek döngü ilerlet.',
            todo: 'Simülasyonu duraklat',
            done: paused,
          },
          {
            text: 'Başlat\'a tekrar bas ve S2 (stop) ile motoru durdur.',
            todo: 'Motor dursun',
            done: all(running, sig('değil M1.calisiyor')),
          },
        ],
      },
      {
        kind: 'task',
        id: 't-g-fan',
        taskId: 'task-fan',
        title: 'Fan start-stop',
        hint: 'Alttaki PLC panelinde Program sekmesini aç. Soldaki PLC komutları menüsünden kontak ve bobin sürükle: (%I0.0 VEYA %Q0.0) VE %I0.1 → %Q0.0.',
      },
      {
        kind: 'lesson',
        id: 't-ladder',
        title: 'Ladder ve ara röle',
        minutes: 6,
        build: fanSchematic,
        steps: [
          {
            text: 'PLC çıkışı küçük akımlı bir sinyaldir, 230 V fanı doğrudan besleyemez. Bu yüzden %Q0.0 bir ara röleyi (K1) sürer, rölenin kontağı fanı besler. Bunu şemada K1 ile E1 arasında görebilirsin.',
          },
          {
            text: 'Ladder okunuşu: soldaki dikey çizgiyi +24 V gibi düşün. Seri kontaklar VE, paralel kontaklar VEYA demektir. Bobin en sağda durur, soldaki yol iletken olunca enerjilenir. Programı PLC panelinde aç.',
            todo: 'PLC panelini aç',
            done: plcOpen,
          },
          START_SIM,
          {
            text: 'S1\'e bir kez bas ve bırak: fan çalışmaya devam eder çünkü %Q0.0 kontağı start\'a paralel (mühür).',
            todo: 'S1 bırakılınca fan çalışsın',
            done: sig('E1.calisiyor ve değil S1.basili'),
          },
          {
            text: 'Kendin dene: Düzenle modunda mühür kontağını (%Q0.0) seçip sil, simülasyonda S1\'i bırakınca fanın durduğunu gör. Sonra Ctrl+Z ile geri al.',
          },
        ],
      },
      {
        kind: 'task',
        id: 't-g-konveyor',
        taskId: 'task-conveyor',
        title: 'Konveyör: fotoselde dur',
        hint: 'Bant için mühürleme devresi kur ve fotosel kontağını (%I0.3) NC olarak seri koy. Lamba (%Q0.1) fotosel kontağıyla (NO) yansın. Gönderme için S1 basılıyken fotosel kontağını köprüle.',
      },
      {
        kind: 'lesson',
        id: 't-setreset',
        title: 'Set / Reset ve kenar',
        minutes: 7,
        build: fanEmpty,
        steps: [
          {
            text: 'Set (S) bobini, önündeki yol bir kez iletken olunca çıkışı 1 yapar ve yol kesilse de 1 tutar. Reset (R) bobini çıkışı 0 yapar. Mühürlemenin alternatifidir. Bu şemada program boş.',
          },
          {
            text: 'PLC panelini aç, Program sekmesinde iki network kur. Network 1: %I0.0 NO kontak → S %Q0.0. Network 2: %I0.1 NC kontak → R %Q0.0. (S2 NC buton olduğu için %I0.1 dinlenmede 1\'dir; basılınca 0 olur, NC kontak o an iletir.)',
            todo: 'PLC panelini aç ve programı yaz',
            done: plcOpen,
          },
          START_SIM,
          {
            text: 'S1\'e bir kez bas ve bırak.',
            todo: 'S1 bırakılınca fan çalışsın',
            done: sig('E1.calisiyor ve değil S1.basili'),
          },
          {
            text: 'S2\'ye bas.',
            todo: 'Fan dursun',
            done: all(running, sig('değil E1.calisiyor')),
          },
          {
            text: 'Kenar kontağı: P (pozitif kenar) kontağı yalnız sinyal 0\'dan 1\'e geçtiği tek scan boyunca iletir, N kontağı 1\'den 0\'a geçerken. Buton basılı tutulsa bile bir işlem bir kez yapılsın istediğinde kullanılır; sayıcılarda göreceksin.',
          },
        ],
      },
      {
        kind: 'lesson',
        id: 't-timer',
        title: 'Zamanlayıcılar',
        minutes: 8,
        build: timerCounterSchematic,
        steps: [
          {
            text: 'TON (gecikmeli çekme): girişi 1 olduktan PT süre sonra çıkışı 1 olur. TOF (gecikmeli bırakma): girişi 0 olduktan PT süre sonra çıkışı 0 olur. TP: girişin kenarında PT süre boyunca 1 verir.',
          },
          {
            text: 'PLC panelini aç. N6 ve N7\'deki iki TON (T1 ve T2) birbirini durdurarak flaşör yapar: T1 500 ms yanık, T2 500 ms sönük süre.',
            todo: 'PLC panelini aç',
            done: plcOpen,
          },
          START_SIM,
          {
            text: 'S1\'e bir kez bas: sayım başladığı için P2 yanıp sönmeye başlar.',
            todo: 'P2 yansın',
            done: sig('P2.yanik'),
          },
          {
            text: 'Flaşörü hızlandır: Düzenle modunda N6\'daki T1 kutusuna tıkla ve süresini 200 ms yap.',
            todo: 'T1 süresi 500 ms\'den kısa',
            done: preset('T1', 'TON', (v) => v < 500),
          },
          {
            text: 'Simülasyonda S1\'e basıp farkı gör. Zamanlayıcının geçen süresini (ET) Online izlemede kutunun içinde okuyabilirsin.',
          },
        ],
      },
      {
        kind: 'lesson',
        id: 't-counter',
        title: 'Sayıcılar',
        minutes: 7,
        build: timerCounterSchematic,
        steps: [
          {
            text: 'CTU (yukarı sayıcı): girişin her yükselen kenarında değeri (CV) 1 artar, CV ön ayara (PV) ulaşınca çıkışı 1 olur. R bobini sayıcıyı sıfırlar. Bu programda C0 S1 basışlarını sayıyor, PV = 3.',
          },
          START_SIM,
          {
            text: 'S1\'e üç kez bas. Üçüncü basıştan 2 s sonra (T0) P1 yanar.',
            todo: 'P1 yansın',
            done: sig('P1.yanik'),
          },
          {
            text: 'S2\'ye bas: sayıcı ve P1 sıfırlanır.',
            todo: 'P1 sönsün',
            done: all(running, sig('değil P1.yanik')),
          },
          {
            text: 'Düzenle modunda N1\'deki C0 kutusuna tıkla ve ön ayarı 5 yap.',
            todo: 'C0 ön ayarı 5',
            done: preset('C0', 'CTU', (v) => v === 5),
          },
          {
            text: 'Simülasyonda bu kez beş basışta P1\'in yandığını gör.',
            todo: '5 basışta P1 yansın',
            done: all(inSim, sig('P1.yanik')),
          },
        ],
      },
      {
        kind: 'task',
        id: 't-g-trafik',
        taskId: 'task-traffic',
        title: 'Trafik ışığı',
        hint: 'Üç TON\'u zincir gibi bağla: T0 (5 s) kırmızı süresini sayar, T0 bitince T1 (5 s) yeşili, T1 bitince T2 (2 s) sarıyı. T0\'ın önüne T2\'nin NC kontağını koyarsan T2 bitince hepsi sıfırlanır ve döngü baştan başlar. Lambalar: kırmızı = T0 değil, yeşil = T0 ve T1 değil, sarı = T1 ve T2 değil.',
      },
      { kind: 'soon', id: 't-g-sayma', title: 'Kutu sayma (sayıcı)', what: 'görev' },
      {
        kind: 'task',
        id: 't-g-yildiz',
        taskId: 'task-star-delta',
        title: 'Yıldız-üçgen yol verme',
        exit: true,
        hint: 'Start-stop ile K1 ve K2\'yi çektir, TON 4 s sonra K2\'yi bırakıp K3\'ü çektir. K2 ve K3 bobinlerinin önüne birbirlerinin NC kontağını koy (kilitleme).',
      },
    ],
  },
  {
    id: 'orta',
    title: 'Orta',
    topic: 'Sıralı kontrol',
    goal: 'Adım mantığıyla çalışan, kilitlemeli ve sensörlerle ilerleyen sıralı makineler programlayabilirsin.',
    items: [
      { kind: 'soon', id: 'o-adim', title: 'Adım mantığı ve durum makinesi', what: 'ders' },
      {
        kind: 'task',
        id: 'o-g-garaj',
        taskId: 'task-garage',
        title: 'Garaj kapısı',
        hint: 'Açma ve kapama iki ayrı start-stop: sınır sensörleri stop gibi davranır. Kapanırken fotosel kesilirse kapamayı bırak, açmayı başlat.',
      },
      {
        kind: 'task',
        id: 'o-g-yaya',
        taskId: 'task-crossing',
        title: 'Butonlu yaya geçidi',
        hint: 'İki hafıza biti kullan: buton %M0.0\'ı set etsin (BEKLEYİN = %M0.0). Araç yeşilken TON T0 (5 s) en az yeşili saysın. %M0.0 ve T0 birlikte %M0.1\'i (geçiş) set etsin. %M0.1\'den başlayan TON zinciri: T1 sarı 2 s, T2 tüm kırmızı 1 s, T3 yaya yeşil 5 s, T4 temizleme 3 s. T4 bitince %M0.1\'i, T2 başlayınca %M0.0\'ı sıfırla. Araç kırmızısına %M0.1 şartını da koy: yoksa geçiş biterken bir scan boyunca kırmızı ve yeşil birlikte yanar.',
      },
      {
        kind: 'task',
        id: 'o-g-kavsak',
        taskId: 'task-junction',
        title: 'Kavşak ve yaya geçidi',
        hint: 'Trafik ışığındaki TON zincirini altı adıma uzat (T0..T5); T0\'ın önüne T5\'in NC kontağını koy. Lambaları adımlardan türet: A kırmızı = T1, B yeşil = T2 ve T3 değil. Yaya için iki hafıza biti kullan: buton %M0.0\'ı set etsin; tüm kırmızıda (T1 ve T2 değil) talep varsa %M0.1 set olsun ve %M0.0 sıfırlansın. Yaya yeşil = %M0.1 ve B yeşil adımı; T3 bitince %M0.1\'i sıfırla.',
      },
      { kind: 'soon', id: 'o-kilit', title: 'Kilitlemeler ve emniyet (acil stop)', what: 'ders' },
      { kind: 'soon', id: 'o-g-pnomatik', title: 'Pnömatik A+ B+ A− B− sırası', what: 'görev' },
      { kind: 'soon', id: 'o-sensor', title: 'Limit switch ve konum sensörleri', what: 'ders' },
      {
        kind: 'task',
        id: 'o-g-pick',
        taskId: 'task-pick-place',
        title: 'Pick & place çevrimi',
        hint: 'Çevrimi adımlara böl (bekle, in, tut, kalk, git, in, bırak, kalk, dön) ve her adımı bir M bitiyle tut. Z aşağıdayken X\'i hareket ettirme.',
      },
      { kind: 'soon', id: 'o-pnomatik', title: 'Pnömatik sıralama', what: 'ders' },
      {
        kind: 'task',
        id: 'o-g-asansor',
        taskId: 'task-elevator',
        title: 'Asansör: 3 kat',
        exit: true,
        hint: 'Çağrıyı bir M bitine kaydet. Çağrılan kat bulunulan kattan yukarıdaysa K1, aşağıdaysa K2; kat sensörü gelince çağrıyı sil. K1 ve K2 birbirini kilitlesin.',
      },
    ],
  },
  {
    id: 'ileri',
    title: 'İleri',
    topic: 'Analog, PID, haberleşme',
    goal: 'Analog sinyalleri ölçekleyip PID ile proses kontrol edebilir, enkoder ve Modbus RTU ile çalışabilirsin.',
    items: [
      { kind: 'soon', id: 'i-analog', title: 'Analog sinyal: 0–10 V, 4–20 mA, 0..27648', what: 'ders' },
      { kind: 'soon', id: 'i-g-alarm', title: 'Tank seviyesi alarmı (analog eşik)', what: 'görev' },
      { kind: 'soon', id: 'i-scale', title: 'SCALE ve karşılaştırma', what: 'ders' },
      { kind: 'soon', id: 'i-pid', title: 'PID ve ayar', what: 'ders' },
      {
        kind: 'task',
        id: 'i-g-pid',
        taskId: 'task-pid',
        title: 'PID seviye kontrolü',
        hint: 'PID kutusuna ölçüm olarak %IW0\'ı, set değeri olarak %IW1\'i ver, çıkışını %QW0\'a yaz. Önce yalnız KP ile dene, sonra TI ekle.',
      },
      { kind: 'soon', id: 'i-hsc', title: 'Hızlı sayıcı ve enkoder', what: 'ders' },
      { kind: 'soon', id: 'i-g-eksen', title: 'Lineer eksen konumlama (enkoder)', what: 'görev' },
      { kind: 'soon', id: 'i-modbus', title: 'Modbus RTU ve frekans konvertörü', what: 'ders' },
      { kind: 'soon', id: 'i-g-modbus', title: 'Modbus ile konveyör hız kontrolü', what: 'görev', exit: true },
    ],
  },
  {
    id: 'saha',
    title: 'Saha Senaryoları',
    topic: 'Arıza bulma ve bitirme projesi',
    goal: 'Gizli arızaları ölçüm ve izlemeyle bulabilir, çok sayfalı bir hattı baştan sona kurabilirsin.',
    items: [
      { kind: 'soon', id: 's-yontem', title: 'Arıza bulma yöntemi (ölç, izle, ayır)', what: 'ders' },
      { kind: 'soon', id: 's-g-ariza1', title: 'Arıza bulma 1: bobin ve kontak arızası', what: 'görev' },
      { kind: 'soon', id: 's-izleme', title: 'Online izleme ve trend ile teşhis', what: 'ders' },
      { kind: 'soon', id: 's-g-ariza2', title: 'Arıza bulma 2: kopuk kablo ve sensör arızası', what: 'görev' },
      { kind: 'soon', id: 's-proje', title: 'Proje yapısı: sayfalar, klemens, adlandırma', what: 'ders' },
      { kind: 'soon', id: 's-g-ariza3', title: 'Arıza bulma 3: süreli, birden çok arıza', what: 'görev' },
      { kind: 'soon', id: 's-g-bitirme', title: 'Bitirme projesi: dolum ve paketleme hattı', what: 'görev', exit: true },
    ],
  },
];

export interface Located {
  level: Level;
  levelIndex: number;
  item: Item;
  index: number;
}

export function locate(id: string): Located | null {
  for (const [levelIndex, level] of LEVELS.entries()) {
    const index = level.items.findIndex((i) => i.id === id);
    if (index >= 0) return { level, levelIndex, item: level.items[index]!, index };
  }
  return null;
}

/** Açılabilir (yazılmış) öğeler, yol sırasıyla. */
export const playable = (): (Lesson | TaskItem)[] =>
  LEVELS.flatMap((l) => l.items.filter((i): i is Lesson | TaskItem => i.kind !== 'soon'));
