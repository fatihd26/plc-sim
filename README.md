# PLC Simülatörü – v0.3

EPLAN/AutoCAD tarzı şema editörü + PLC simülasyonu. Bileşenler kütüphaneden çizim alanına
sürüklenip bırakılır, terminaller kabloyla bağlanır; simülasyon modunda aynı şema canlı çalışır
(potansiyel renkleri, kontak durumları, motor, koruma açmaları, PLC online izleme). Her PLC'nin
ladder programı alt panelden düzenlenir. Proje birden çok sayfadan oluşabilir.

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
| PLC paneli (alt) | Düzenlemede ladder editörü, simülasyonda online izleme ve I/O tablosu; PLC seçici |
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
| Komuta | Buton NO / NC (S), acil stop – kilitlemeli (S) |
| Şalt | Kontaktör, bobin 24 V DC / 230 V AC (K) |
| Koruma | Motor koruma şalteri – termik + manyetik açma (Q), otomatik sigorta 1P (F), termik röle (F) |
| Tüketiciler | Asenkron motor 3~, yük oranı ayarlı (M) |
| Sinyal | Sinyal lambası 24 V DC / 230 V AC (P) |
| Kontrol | PLC 8 DI / 8 DQ, kendi ladder programıyla (A) |
| Bağlantı | Klemens (X), bağlantı noktası (J), sayfa geçişi (XR) |
| Kullanıcı | Kutup türlerinden tanımlanan bileşenler (proje dosyasında saklanır) |

Parametreler `sim/catalog.ts` içinde tip başına tanımlıdır ve Özellikler panelinde düzenlenir.

Yeni bir yerleşik tip eklemek için: `sim/catalog.ts` (terminaller, parametreler), `sim/simulation.ts`
(davranış), `ui/editor/geometry.ts` (terminal konumları) ve `ui/editor/symbols.tsx` (çizim).
`editor.test.ts` katalog ile geometrinin tutarlılığını denetler. Kod yazmadan bileşen eklemek için
kütüphanedeki "Yeni bileşen tanımla" kullanılır.

## Yapı

```
src/sim/   Simülasyon çekirdeği (saf TS; React/DOM/Math.random/Date.now yasak — purity.test.ts denetler)
  address.ts      %I/%Q/%M bit adresleme
  ladder.ts       Ladder modeli (seri/paralel ağaç), derleme, güç akışı değerlendirme
  ladderEdit.ts   Ladder üzerinde saf düzenleme işlemleri (seri/paralel ekle, sil, normalize)
  symbolTable.ts  PLC adresi → kablolamadan bulunan şema elemanı
  plc.ts          Terminaller, process image (PII/PIQ/M), scan()
  devices.ts      PushButton, Contactor, ThermalRelay, Motor
  catalog.ts      Bileşen kütüphanesi: tip, kategori, terminaller, parametreler, kullanıcı tanımları
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
