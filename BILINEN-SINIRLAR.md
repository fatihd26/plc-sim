# Bilinen sınırlar (v0.2)

Sonradan ele alınacak eksikler. Her madde, ilgili kodun yerini ve olası bir çözüm yönünü içerir.

## PLC programı

- [ ] **Program sabit.** Tüm PLC'ler start-stop mühürleme programını çalıştırır
  (`src/sim/programs.ts`, `DEFAULT_CONFIG` → `src/sim/simulation.ts`). Kullanıcı programı
  düzenleyemez.
  *Çözüm yönü:* programı şema dokümanına (veya PLC bileşen örneğine) bağlamak, bir ladder editörü eklemek.
- [ ] **Programdaki etiketler sabit.** Ladder'daki "S1 Start", "K1 Kontaktör" gibi etiketler,
  şemadaki gerçek bağlantılardan bağımsızdır. Elemanların adı değişse ya da kablolama farklı olsa da
  bu etiketler aynı kalır.
- [ ] **Alt panel yalnız ilk PLC'yi gösterir.** Şemada birden fazla PLC varsa alt panelde sadece
  ilki izlenir (`firstPlc` → `src/ui/App.tsx`).
  *Çözüm yönü:* seçili PLC'yi izlemek veya alt panelde PLC seçici kullanmak.

## Kablo çizimi

- [ ] **Otomatik yönlendirme engellerden kaçmaz.** Kablolar elemanların ve birbirlerinin üzerinden
  geçebilir, bu yüzden örnek şemada üst üste binen hatlar var (`src/ui/editor/routing.ts`).
  *Çözüm yönü:* ızgara üzerinde A* gibi engelden kaçan bir yönlendirme, ayrıca paralel kabloları
  kaydırmak.
- [ ] **Kablo elle şekillendirilemez.** Kablolara büküm noktası eklenemez, güzergâhları
  taşınamaz. Kablo yalnız iki terminal arasında otomatik çizilir.
- [ ] **Bağlantı noktası (junction) yok.** Bir kablo ancak terminalden başlayıp terminalde
  bitebilir, başka bir kablonun ortasından dallanamaz.

## Bileşenler ve simülasyon

- [ ] **Bileşen parametreleri düzenlenemez.** Termik ayar akımı (Ir = 4 A), motor değerleri,
  kontaktör çekme/bırakma süreleri ve PLC scan süresi (10 ms) sabittir (`createDevice` →
  `src/sim/simulation.ts`). Özellikler panelinde sadece etiket değiştirilebilir.
- [ ] **Kısa devre sadece uyarı olarak gösterilir.** Kısa devre algılanır ve durum çubuğunda
  görünür. Ancak hiçbir koruma (sigorta ya da şalter) açmaz ve simülasyon devam eder.
- [ ] **Motor koruma şalteri sadece elle açılıp kapanır.** Aşırı akımda veya kısa devrede
  kendiliğinden açmaz.
- [ ] **Gerilim seviyeleri sınırlı.** Bobin ve lamba sadece 24 V DC ile çalışır. Mantıksal çözücü
  akım ve gerilim hesaplamaz, sadece potansiyel etiketi taşır (`src/sim/netlist.ts`).
- [ ] **Kütüphane kod içinde tanımlı.** Kullanıcı arayüzden yeni bileşen tipi ekleyemez. Yeni bir
  tip eklemek için 4 dosyayı birlikte değiştirmek gerekir (bkz. README › Kütüphane).

## Editör

- [ ] **Çoklu seçim yok.** Aynı anda tek eleman veya tek kablo seçilebilir. Kutu ile seçme,
  kopyala/yapıştır ve grup taşıma yok.
- [ ] **Sayfa yapısı yok.** EPLAN'daki gibi çok sayfalı proje, antet ve sayfalar arası referans
  bulunmuyor. Tüm şema tek bir sonsuz çizim alanında duruyor.
- [ ] **Dar ekran desteği zayıf.** Düzen masaüstüne göre tasarlandı. 760 px altında paneller alt
  alta diziliyor ama dokunmatik kullanım test edilmedi.
