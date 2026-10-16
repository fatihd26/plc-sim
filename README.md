# PLC Simülatörü – v0.4

EPLAN/AutoCAD tarzı şema editörü + PLC simülasyonu. Bileşenler kütüphaneden çizim alanına
sürüklenip bırakılır, terminaller kabloyla bağlanır; simülasyon modunda aynı şema canlı çalışır
(potansiyel renkleri, kontak durumları, motor, koruma açmaları, PLC online izleme). Her PLC'nin
ladder programı alt panelden düzenlenir. Proje birden çok sayfadan oluşabilir.

Hedef kitle, kendi başına pratik yapan MYO ve üniversite 1. sınıf öğrencisi. Üst çubuktaki
**🎓 Öğren** düğmesi 5 seviyeli eğitim yolunu açar (Başlangıç → Saha Senaryoları): kısa dersler,
canlı denetlenen adımlar ve otomatik kontrollü görevler. Temel ilke şu: öğrenci ladder'dan
makineyi hayal etmek zorunda kalmamalı, programın sürdüğü mekanizma ekranda canlı çalışmalı.
Eğitim kararları ve plan için bkz. [idea.md](idea.md).

```
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest birim + entegrasyon testleri
npm run build      # tip kontrolü + üretim derlemesi
```

## Çalışma alanı

| Alan | İşlev |
|---|---|
| Şerit (üst) | Dosya (yeni, örnek, aç/kaydet `.plcsim.json`), düzen, görünüm, simülasyon komutları |
| Kütüphane (sol) | Kategorili bileşen listesi, arama; sürükle-bırak veya tıkla-yerleştir; kullanıcı bileşeni tanımlama |
| Çizim alanı | Sayfa çerçevesi ve antet, ızgara, yakalama (10), zoom, kaydırma, kutu ile seçim, engelden kaçan (A*) kablo yönlendirme |
| Sayfa sekmeleri | Sayfa ekle / yeniden adlandır (çift tık) / sil |
| Özellikler (sağ) | Seçili eleman/kablo: etiket, parametreler, terminal bağlantıları, canlı durum; proje adı ve olay günlüğü |
| Alt panel | **Program / Online izleme**: ladder editörü veya canlı izleme ve I/O tablosu; **Trend**: seçilen sinyallerin zaman grafiği; **Görev**: görev metni ve otomatik denetim |
| Durum çubuğu | İmleç koordinatı, zoom, mod, son koruma olayı, kısa devre uyarısı |

Şema tarayıcıda otomatik kaydedilir.

| Kısayol | İşlev |
|---|---|
| Sürükle (kütüphane → alan) | Eleman ekle |
| Terminal → terminal (sürükle veya iki tık) | Kablo çiz |
| Terminal → kablonun ortası | Bağlantı noktası oluşturup dallan |
| Seçili kablonun kare tutamacı | Kablo parçasını kaydır (elle güzergâh) |
| Boş alanda sürükle | Kutu ile seç (soldan sağa: içindekiler, sağdan sola: değenler) |
| `Shift`/`Ctrl` + tık · `Ctrl+A` | Seçime ekle/çıkar · tümünü seç |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | Kopyala / kes / yapıştır (imleçte) / çoğalt |
| Tekerlek / orta veya sağ tuş | Zoom / kaydır (dokunmatik: iki parmak / tek parmak) |
| `R` · `Del` · `Esc` | Döndür · sil · iptal |
| `PgUp` / `PgDn` | Önceki / sonraki sayfa |
| Sayfa geçişine çift tık | Karşı sayfaya git |
| `Ctrl+Z` / `Ctrl+Y` | Geri al / yinele |
| `F` | Tümünü sığdır |
| `F5` · `Boşluk` | Simülasyon modu · başlat/duraklat |

## Kütüphane

| Kategori | Bileşenler |
|---|---|
| Kaynaklar | Şebeke 3~/N 400/230 V (X), güç kaynağı 24 V DC – kısa devrede akım sınırlaması (G) |
| Komuta | Buton NO / NC (S), acil stop – kilitlemeli (S), set değeri potansiyometresi 0–10 V (R) |
| Şalt | Kontaktör, bobin 24 V DC / 230 V AC (K); ara röle 13-14/23-24 NO, 31-32 NC (K) |
| Koruma | Motor koruma şalteri – termik + manyetik açma (Q), otomatik sigorta 1P (F), termik röle (F) |
| Tüketiciler | Asenkron motor 3~ (M), 6 uçlu Y/Δ motor – yıldızda 1/3 akım (M), frenli motor (M) |
| Sürücüler | Frekans konvertörü: klemens (DI1-3, AI 0–10 V) veya Modbus RTU slave kumandası, rampa, röle çıkışları (T) |
| Sinyal | Sinyal lambası 24 V DC / 230 V AC (P) |
| Sensörler | Endüktif (yalnız metal), kapasitif, optik sensör – 3 telli PNP (B); limit switch (S); artımlı enkoder A/B (B); seviye, sıcaklık (PT100), basınç transmitteri – 4–20 mA / 0–10 V (B) |
| Kontrol | PLC 8 DI / 8 DQ / 2 AI / 2 AQ, 2 hızlı sayıcı, RS485 Modbus RTU master (A); ESP32 I/O kartı (A) |
| Bağlantı | Klemens (X), bağlantı noktası (J), sayfa geçişi (XR) |
| Mekanik | Pnömatik silindir + valf (Y), konveyör – karton/metal kutu (M), fan (M), pompa + depo (M) |
| Proses | Seviye kontrol tankı – selenoid veya oransal giriş vanası, tüketim (T); elektrikli fırın – aç-kapa veya tristör, emniyet termostatı (E) |
| Pnömatik | Hava kaynağı (P), 5/2 yay dönüşlü, 5/2 çift bobinli, 5/3 orta kapalı, 3/2 selenoid valf (Y), tek yönlü akış kontrol valfi (V), çift / tek etkili silindir (Z) |
| Hidrolik | Güç ünitesi – pompa, emniyet valfi, tank (P); 4/3 valf – kapalı / tandem / yüzer merkez (Y); hidrolik silindir (Z); ekskavatör kolu – bom, arm, kova (Z) |
| Robotik | Lineer eksen – enkoder, REF, sınır sensörleri (M); elektro-pnömatik pick & place (U); el sıkışmalı robot hücresi (R); 3 katlı asansör (M); garaj kapısı (M) |
| Sahneler | Trafik ışığı – tek yönlü yol, araçlar yeşilde geçer, kırmızıda durma çizgisinde bekler (H); kavşak – A ve B yolu, yaya geçidi, yaya ışığı ve yaya butonu (PB, PNP); çakışan yeşiller, kavşakta karşılaşan araçlar ve geçitteki yayaya gelen araç sahnede uyarı verir (H). Butonlu yaya geçidi – iki yönlü yol, iki kaldırım, araç ve yaya ışıkları, BEKLEYİN lambası (W) ve yaya butonu (PB) (H). Lamba uçları LED sürücü kartının sinyal girişleridir, PLC çıkışına doğrudan bağlanır |
| Kullanıcı | Kutup türlerinden tanımlanan bileşenler (proje dosyasında saklanır) |

**Sensör hedefi.** Sensör ve transmitterlerin "Algıladığı mekanizma / Ölçtüğü proses" parametresi
bir bileşenin adıdır (konveyör, silindir, eksen, tank, fırın, güç ünitesi...). Konum sensörleri
mekanizmanın belirli bir noktasına (%) bakar. Hedef seçilmezse simülasyonda sensöre tıklayarak
nesne konur veya transmitter değeri kaydırıcıyla verilir.

**Analog G/Ç.** Analog çıkışlı cihazlar (transmitter, potansiyometre, PLC AQ) bağlı oldukları
nete sinyal yazar; kablolar mor noktalı görünür. PLC'de %IW0..1 ham değeri 0..27648'dir
(0–10 V veya 4–20 mA, parametreyle seçilir); 4–20 mA girişte kablo kopuk veya yanlış sinyal tipi
32767 okunur. %QW0..1 = 0..27648 → AQ0..1 = 0–10 V. Ladder kutu komutları: MOVE, ADD, SUB, MUL,
DIV, SCALE ve PID (PLC komutları › Matematik / Analog ve PID).

**Hızlı sayıcı.** PLC parametresinde HSC0 (I0.0/I0.1) ve HSC1 (I0.2/I0.3) yukarı sayma veya A/B
kuadratür olarak açılır; değer `HC0`/`HC1` operandıyla karşılaştırılır, reset bobini (`R HC0`)
sıfırlar.

**Akışkan devreleri.** Pnömatik ve hidrolik portlar hortumla (kesikli mavi / turuncu) bağlanır;
elektrik ucu akışkan portuna bağlanamaz. Basınçlı hat kalın çizilir. Hidrolikte pompa debisi en
düşük basınç isteyen aktüatöre gider; hareket edemeyen sistemde emniyet valfi açar.

**Arıza enjeksiyonu.** Özellikler panelinde her bileşenin arıza listesi vardır (bobin yanık, kontak
yapışık, sensör arızalı, kaplin kaymış...). Düzenlemede işaretlenen arızalar ve "kablo kopuk"
işaretli kablolar simülasyon başında etkindir; Proje ayarından öğrenciden gizlenebilir (arıza
bulma alıştırması). Simülasyonda arızalar anlık açılıp kapatılabilir.

**Trend.** Alt paneldeki Trend sekmesinde en fazla 4 sinyal ortak zaman ekseninde, her biri kendi
şeridinde çizilir (5/10/30/60 s pencere). Sinyal adları Özellikler › Sinyaller tablosundadır.

**Görev modu.** Bir projeye görev (açıklama + denetim senaryosu) eklenebilir. "Kontrol et",
senaryoyu ayrı ve hızlı bir simülasyonda koşturup satır satır sonuç verir. Senaryo dili:
`bas S1`, `bırak S1`, `tıkla S1 200 ms`, `aç/kapat Q1`, `eylem M1 addBox`, `arıza K1 coil`,
`kopar w3`, `bekle 2 s`, `bekle K1.kontak en fazla 5 s`, `kontrol T1.seviye >= 45 ve değil P1.yanik
boyunca 2 s`. Hazır görevler: Örnek ▾ › Görevler.

PLC komutları şemaya değil PLC programına eklendiği için sol kütüphanede değil, alt paneldeki
ladder editörünün solundaki **PLC komutları** menüsündedir: kontak NO/NC/P/N, karşılaştırma,
bobin/ters bobin/set/reset, TON/TOF/TP/TONR (T0..T15), CTU/CTD/CTUD (C0..C15), MOVE/ADD/SUB/MUL/DIV,
SCALE, PID. Komut ladder
üzerine sürüklenir (elemana: sağına seri, Shift ile paralel; boş alana: yeni network) veya tıklanır.

**ESP32 ladder ile programlanır.** Firmware "Ladder programı" (varsayılan) iken kart PLC gibi
çalışır ve programı alt paneldeki kontrolör seçicisinden düzenlenir. Hangi GPIO pininin hangi
adres olduğu **G/Ç eşlemesi** ile belirlenir (ladder araç çubuğu "⚙ G/Ç eşlemesi" veya ESP32
parametreleri): her pinin yönü (giriş/çıkış) ve adresi (`Otomatik` ya da `%I0.0..0.7` /
`%Q0.0..0.7`). Otomatik pinler boştaki ilk adresi alır (varsayılan: GPIO16 = `%I0.0`,
GPIO17 = `%I0.1`, GPIO18 = `%Q0.0`, GPIO19 = `%Q0.1`). "Programdan otomatik" düğmesi pinleri
programın kullandığı adreslere göre ayarlar ve mevcut eşlemeyi korur; yönü çevrilen pini bildirir.
Aynı adres iki pine verilirse şema hatası olur. Ladder'da adres yazarken öneri listesi çıkar ve
adresin hangi pine gittiği (ya da hiçbir pine bağlı olmadığı) gösterilir. ADC1 her döngüde
`%MW0`'a (ham, 0..4095 = 0..10 V) ve `%MW1`'e (mV) yazılır. Modbus slave görünümü: coil ↔ `%Q`,
discrete input ↔ `%I`, holding register ↔ `%MW`, IR0/IR1 = ADC. Scan periyodu "Firmware döngüsü"
ayarıdır.

**Modbus RTU.** PLC'nin RS485_A/B uçları, ESP32'lerin RS485 uçlarıyla A-A, B-B bağlanır. PLC
programı panelindeki "⇄ Modbus" düğmesi master tarama tablosunu açar. Her satırda slave adresi,
işlev (FC1–6, 15, 16), uzak adres, adet, PLC adresi ve periyot bulunur. Okumada değer PLC'ye
yazılır (bit → `%M`, register → `%MW`), yazmada PLC'den alınır (bit ← `%I/%Q/%M`, register ←
`%MW`). Bus kablolamadan bulunur; çerçeve süreleri baud hızına göre hesaplanır. A/B ters
bağlı, enerjisiz, adresi veya baud'u farklı slave yanıt vermez (zaman aşımı). Aynı bus'ta iki
master veya köprülenmiş A/B bus hatasıdır. Simülasyonda satır durumları I/O tablosunun altında
görünür. Örnek: "PLC ↔ ESP32 Modbus RTU".

**PLC çıkışı yük beslemez.** %Q çıkışları yalnız bobin (röle, kontaktör) sürer. Lamba, fan,
valf gibi bir yük PLC veya ESP32 çıkış netine bağlanırsa simülasyonda çalışmaz ve "PLC çıkışından doğrudan
beslenemez, araya röle koyun" arızası verir. Tek fazlı (230 V) ve 24 V yükler ara röle kontağı
üzerinden beslenir; örneklerin tamamı bu düzendedir.

## Yeni bileşen eklemek (modül sistemi)

Bir bileşen iki dosyadır; çekirdek ve UI bileşen tipini başka hiçbir yerde tanımaz:

1. **`src/sim/modules/<ad>.ts`** – `defineModule({ spec, create, links, drive, fluidLinks,
   update, state, signals, faults, command, probe, measure, ... })`. `spec` terminalleri,
   parametreleri, kategoriyi ve (varsa) akışkan portlarını tanımlar. Kancaların hangi fazda
   çağrıldığı `src/sim/modules/types.ts` başında anlatılır. `src/sim/modules/index.ts` içindeki
   `MODULES` listesine eklenir.
2. **`src/ui/devices/<ad>.tsx`** – `defineView({ type, geometry, Body, click, controls })`:
   terminal konumları, sembol çizimi, tıklama eylemi ve Özellikler panelindeki kontroller.
   `src/ui/devices/index.ts` içindeki `VIEWS` listesine eklenir.

Katalog, kütüphane, simülasyon, Özellikler (parametreler, sinyaller, arızalar, kontroller), trend,
görev senaryoları ve hedef seçimi yeni bileşeni kendiliğinden tanır. `editor.test.ts` her modülün
görünümü olduğunu ve terminallerin eşleştiğini, `purity.test.ts` modül kodunun deterministik
kaldığını denetler. Testlerde ve örneklerde şema kurmak için `src/sim/build.ts` kullanılır.
Kod yazmadan basit bileşen eklemek için kütüphanedeki "Yeni bileşen tanımla" hâlâ kullanılabilir.

## Yapı

```
src/sim/   Simülasyon çekirdeği (saf TS; React/DOM/Math.random/Date.now yasak — purity.test.ts denetler)
  address.ts      %I/%Q/%M bit, T/C ve %MW kelime adresleme
  ladder.ts       Ladder modeli (seri/paralel ağaç), derleme, güç akışı, zamanlayıcı/sayıcı yürütme
  instructions.ts Ladder komut kütüphanesi (palet ve sol kütüphane)
  ladderEdit.ts   Ladder üzerinde saf düzenleme işlemleri (seri/paralel ekle, sil, normalize)
  symbolTable.ts  PLC adresi → kablolamadan bulunan şema elemanı
  plc.ts          Terminaller, process image (PII/PIQ/M), scan(); Modbus slave görünümü
  esp32.ts        ESP32 I/O kartı: firmware (ladder / Modbus slave / yerel), GPIO, ADC, RS485 bus bulma
  modbusMaster.ts PLC Modbus master: tarama tablosu, doğrulama, periyodik istek, sonuçları %M/%MW'ye yazma
  ioConfig.ts     Kontrolör G/Ç eşlemesi (PLC sabit, ESP32 pin yönü/adresi), programdan otomatik yapılandırma
  modbus.ts       Modbus veri modeli, istek işleyici (FC1-6, 15, 16), RTU çerçeve/CRC, sanal RS485 bus
  devices.ts      PushButton, Contactor, ThermalRelay, Motor, Cylinder, Conveyor, Tank
  spec.ts         Bileşen tanımı ve parametre tipleri (çekirdek ve modüller ortak)
  catalog.ts      Bileşen kütüphanesi: çekirdek tipler + modüller, kullanıcı tanımları, çekirdek arızalar
  modules/        Bileşen modülleri: sensörler, analog, sürücüler, mekanik, proses, pnömatik, hidrolik, robotik
  boxes.ts        Ladder kutu komutları (MOVE, ADD, SUB, MUL, DIV, SCALE, PID)
  signals.ts      Bileşenlerin adlandırılmış canlı değerleri (trend ve görevler)
  scenario.ts     Görev senaryosu dili ve çalıştırıcı
  tasks.ts        Hazır görevler
  build.ts        Kodla şema / ladder kurma yardımcıları
  examplesLib.ts  Kütüphane örnek projeleri
  schematic.ts    Şema dokümanı (sayfalar, bileşenler, kablolar, kütüphane), doğrulama, sürüm taşıma
  netlist.ts      Union-find bağlantı çözücü, potansiyel ve kısa devre tespiti
  programs.ts     Start-stop mühürleme programı
  examples.ts     Start-stop örnek şeması
  simulation.ts   1 ms tick, faz sırası, koruma, komut kuyruğu, snapshot, replay
src/ui/    React katmanı (çekirdeğe yalnız komut gönderir, snapshot okur)
  App.tsx         Uygulama kabuğu: şerit, paneller, sayfa sekmeleri, durum çubuğu, kısayollar
  LadderEditor.tsx / LadderView.tsx  Ladder editörü ve online izleme
  project.ts      JSON içe/dışa aktarma, otomatik kayıt
  editor/         Çizim alanı, kütüphane, özellikler, semboller, geometri, A* kablo yönlendirme,
                  sayfa düzeni, geri al/yinele destekli doküman reducer'ı
  devices/        Modüllerin görünümleri (geometri, sembol, kontroller)
  TrendPanel.tsx  Trend grafiği · TaskPanel.tsx  Görev ve otomatik denetim
```

Dosya biçimi `version: 2`'dir. v0.2 dosyaları (`version: 1`) açılırken otomatik taşınır.

## Örnek devre (start-stop)

| Terminal | Saha cihazı |
|---|---|
| %I0.0 | S1 Start (NO) |
| %I0.1 | S2 Stop (NC) |
| %I0.2 | F2 termik 95-96 (NC) |
| %Q0.0 | K1 bobini |

Bilinen sınırlar: [BILINEN-SINIRLAR.md](BILINEN-SINIRLAR.md)
