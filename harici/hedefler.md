# Doğal dil entegrasyonu – hedefler

Kullanıcı ne istediğini anlatır; AI ladder programını ve elektrik şemasını oluşturur, simülatörde
doğrular.

Temel fikir: ladder (`LadderProgram`: seri/paralel ağaç) ve şema (`Schematic`: bileşen + terminal
bağlantısı) zaten saf JSON veri. AI'nın çizim yapması gerekmez; şemaya uygun JSON üretmesi yeterli.
Doğrulamayı `compileProgram` ve simülatör yapar.

## 1. Hazır çözümler

| Çözüm | Ne yapıyor | Bizim için anlamı |
|---|---|---|
| Siemens Industrial Copilot (TIA Portal) | Doğal dilden SCL kodu üretir | Ticari, kapalı; ladder değil metin kod |
| Beckhoff TwinCAT Chat | IDE içinde LLM ile ST kodu | Aynı yaklaşım: metin kod + insan onayı |
| Rockwell FactoryTalk Design Studio Copilot | Kod üretme / açıklama | Ticari |
| LLM4PLC / Agents4PLC (akademik, 2024) | LLM üretir → derleyici + model checker doğrular → hata LLM'e geri döner | Kopyalanacak mimari. Döngüdeki doğrulayıcı bizim simülatörümüz |
| EPLAN / elektrik şeması tarafı | Makro/şablon tabanlı otomatik şema | Doğal dilden elektrik şeması üreten olgun hazır çözüm yok; fark yaratılabilecek alan |

Tak-çalıştır bir kütüphane yok. Ortak tarif: **LLM + yapılandırılmış çıktı (JSON şema / tool use)
+ deterministik doğrulama döngüsü.**

## 2. Mimari: aşamalı pipeline

```
Kullanıcı: "İki butonla motoru çalıştır-durdur, termik atınca lamba yansın"
   │
   ▼
[1] Gereksinim çıkarımı (LLM)  → Spec JSON: I/O listesi, davranış kuralları; eksikse soru sor
   │
   ▼
[2] I/O ataması (deterministik kod) → S1→%I0.0, S2→%I0.1, K1→%Q0.0 ...
   │
   ├──► [3a] Ladder üretimi (LLM, JSON şemayla) → LadderProgram
   │          └ compileProgram() ile doğrula, hata varsa LLM'e geri ver
   │
   └──► [3b] Elektrik şeması (LLM yalnız "ne nereye bağlanır" der)
              → makro seçimi + netlist → otomatik yerleşim + routing (bizim kodumuz)
   │
   ▼
[4] Test senaryoları (LLM üretir, simülatör koşar)
     "S1'e bas → K1=1; S2'ye bas → K1=0; F2 atınca → P1=1"
     Başarısızsa hata + trace LLM'e döner, en fazla N tur
   │
   ▼
[5] Kullanıcıya önizleme + diff: "Kabul et / düzenle"
```

### Kritik tasarım kararları

1. **AI koordinat üretmez.** LLM'ler x/y yerleşiminde kötü, topolojide iyi. AI "K1 bobini A1 ←
   PLC Q0.0, A2 ← 0V" der; yerleşimi deterministik bir layout algoritması yapar (akım yolları
   soldan sağa / üstten alta sütunlar). `BILINEN-SINIRLAR.md`'deki A* routing ile birlikte gelişir.
2. **Makro (devre şablonu) katmanı.** "Direkt yol verme motor", "PLC'li start-stop",
   "yıldız-üçgen" gibi parametreli bloklar. AI çoğunlukla
   `useMacro("DOL_motor", {name: "M1", plcOutput: "%Q0.0"})` çağırır; ham netlist yalnız istisnada.
3. **Tool use ile editör aksiyonları.** `EditorAction` reducer'ı (`add`, `connect`, `rename`...)
   neredeyse doğrudan LLM araçlarına dönüşür. AI'nın değişiklikleri undo/redo geçmişine düşer.
4. **Doğrulama döngüsü asıl değer.** Simülatör saf ve deterministik (`purity.test.ts`); AI
   çıktısını otomatik test etmek için ideal. "AI çizdi" ile "AI çizdi ve çalıştığını kanıtladı"
   arasındaki fark bu.

## 3. Önce çözülmesi gereken engeller

- [ ] **Program sabit** (`src/sim/programs.ts`, `DEFAULT_CONFIG`). Program şema dokümanına
  taşınmalı; yoksa AI'nın ürettiği ladder'ı koyacak yer yok.
- [ ] **Ladder DSL dar.** Yalnız NO/NC kontak + bobin var. Timer (TON/TOF), set/reset, sayaç
  olmadan "5 sn sonra", "3 kez basınca" gibi yaygın istekler karşılanamaz. AI'nın tavanı DSL'in
  tavanı.
- [ ] **Etiketler şemaya bağlı değil.** I/O ataması için tek doğruluk kaynağı (sembol tablosu)
  olmalı; ladder ve şema aynı tabloyu referans almalı.

## 4. LLM nerede çalışacak?

Uygulama saf Vite/React SPA; API anahtarı tarayıcıya konamaz.

- **Küçük backend proxy** (Vite dev middleware, Cloudflare Worker veya Node/Express) – önerilen.
- **Kullanıcı kendi anahtarını girer** (BYOK) – prototip için hızlı, ürün için zayıf.
- **Yerel model** (Ollama / WebLLM) – ücretsiz, çevrimdışı; ama çok adımlı yapılandırılmış
  çıktıda büyük modellere göre belirgin şekilde zayıf.

## 5. Yol haritası

1. [ ] **v0.3 ön hazırlık:** program dokümana taşınır, sembol tablosu, DSL'e TON + SR.
2. [ ] **Yalnız ladder:** metin → `LadderProgram` JSON → `compileProgram` doğrulama → onay ekranı.
3. [ ] **Test döngüsü:** AI senaryo üretir, simülatör koşar, hatalar geri döner.
4. [ ] **Elektrik tarafı:** önce makro kütüphanesi + auto-layout, sonra AI ile makro seçimi.
5. [ ] **Sohbetle düzenleme:** "Bir de acil stop ekle" gibi artımlı değişiklikler, diff olarak.

İlk adım önerisi: 2. maddeden küçük bir dikey prototip. Tek metin kutusu → AI'dan `LadderProgram`
JSON → `compileProgram` → mevcut `LadderView`'da gösterim. Mimarinin en riskli kısmını ucuza test
eder.
