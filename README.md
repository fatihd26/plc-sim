# PLC Simülatörü – v0.2

EPLAN/AutoCAD tarzı şema editörü + PLC simülasyonu. Bileşenler kütüphaneden çizim alanına
sürüklenip bırakılır, terminaller kabloyla bağlanır; simülasyon modunda aynı şema canlı çalışır
(potansiyel renkleri, kontak durumları, motor, PLC online izleme).

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
| Kütüphane (sol) | Kategorili bileşen listesi, arama; sürükle-bırak ile ekleme |
| Çizim alanı | Izgara, yakalama (10), imleç merkezli zoom, kaydırma, ortogonal kablo yönlendirme |
| Özellikler (sağ) | Seçili eleman/kablo: etiket, konum, terminal bağlantıları, canlı durum |
| PLC paneli (alt) | Simülasyonda ladder online izleme ve I/O tablosu |
| Durum çubuğu | İmleç koordinatı, zoom, mod, kısa devre uyarısı |

Şema tarayıcıda otomatik kaydedilir.

| Kısayol | İşlev |
|---|---|
| Sürükle (kütüphane → alan) | Eleman ekle |
| Terminal → terminal (sürükle veya iki tık) | Kablo çiz |
| Tekerlek / boş alan veya orta tuş | Zoom / kaydır |
| `R` · `Del` · `Esc` | Döndür · sil · iptal |
| `Ctrl+Z` / `Ctrl+Y` | Geri al / yinele |
| `F` | Tümünü sığdır |
| `F5` · `Boşluk` | Simülasyon modu · başlat/duraklat |

## Kütüphane

| Kategori | Bileşenler |
|---|---|
| Kaynaklar | Şebeke 3~ 400 V (X), güç kaynağı 24 V DC (G) |
| Komuta | Buton NO / NC (S), acil stop – kilitlemeli (S) |
| Şalt | Kontaktör 24 V DC (K) |
| Koruma | Motor koruma şalteri (Q), termik röle (F) |
| Tüketiciler | Asenkron motor 3~ (M) |
| Sinyal | Sinyal lambası 24 V (P) |
| Kontrol | PLC 8 DI / 8 DQ (A) |
| Bağlantı | Klemens (X) |

Yeni bir tip eklemek için: `sim/catalog.ts` (terminaller), `sim/simulation.ts` (davranış),
`ui/editor/geometry.ts` (terminal konumları) ve `ui/editor/symbols.tsx` (çizim).
`editor.test.ts` katalog ile geometrinin tutarlılığını denetler.

## Yapı

```
src/sim/   Simülasyon çekirdeği (saf TS; React/DOM/Math.random/Date.now yasak — purity.test.ts denetler)
  address.ts      %I/%Q/%M bit adresleme
  ladder.ts       Ladder modeli (seri/paralel ağaç), derleme, güç akışı değerlendirme
  plc.ts          Terminaller, process image (PII/PIQ/M), scan()
  devices.ts      PushButton, Contactor, ThermalRelay, Motor
  catalog.ts      Bileşen kütüphanesi: tip, kategori, terminal adları
  schematic.ts    Şema dokümanı (bileşen örnekleri + kablolar), doğrulama
  netlist.ts      Union-find bağlantı çözücü, potansiyel ve kısa devre tespiti
  programs.ts     Start-stop mühürleme programı
  examples.ts     Start-stop örnek şeması
  simulation.ts   1 ms tick, faz sırası, komut kuyruğu, snapshot, replay
src/ui/    React katmanı (çekirdeğe yalnız komut gönderir, snapshot okur)
  App.tsx         Uygulama kabuğu: şerit, paneller, durum çubuğu, kısayollar
  project.ts      JSON içe/dışa aktarma, otomatik kayıt
  editor/         Çizim alanı, kütüphane, özellikler, semboller, geometri, kablo yönlendirme,
                  geri al/yinele destekli doküman reducer'ı
```

## Örnek devre (start-stop)

| Terminal | Saha cihazı |
|---|---|
| %I0.0 | S1 Start (NO) |
| %I0.1 | S2 Stop (NC) |
| %I0.2 | F2 termik 95-96 (NC) |
| %Q0.0 | K1 bobini |
