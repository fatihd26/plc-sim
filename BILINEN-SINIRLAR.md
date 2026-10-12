# Bilinen sınırlar

## v0.2 listesi: çözülenler (v0.3)

### PLC programı

- [x] **Program sabit.** Program artık her PLC örneğinde saklanır (`ComponentInstance.program`).
  Alt paneldeki ladder editöründen network eklenip sıralanabilir. Seri/paralel kontak eklenebilir,
  adres, NO/NC ve açıklama değiştirilebilir (`src/sim/ladderEdit.ts`, `src/ui/LadderEditor.tsx`).
  Program şema dosyasıyla kaydedilir ve geri alınabilir.
- [x] **Programdaki etiketler sabit.** Ladder'daki eleman adları sembol tablosundan gelir
  (`src/sim/symbolTable.ts`). %I/%Q terminalinden kablolar boyunca (klemens, bağlantı noktası ve
  sayfa geçişleri üzerinden) ilerlenir ve bulunan elemanın adı gösterilir. Ad veya kablolama
  değişince etiket de değişir. Elle yazılan metin artık yalnız açıklamadır.
- [x] **Alt panel yalnız ilk PLC'yi gösterir.** Alt panelde PLC seçici var. Bir PLC seçilince panel
  ona geçer.

### Kablo çizimi

- [x] **Otomatik yönlendirme engellerden kaçmaz.** Sayfadaki kablolar ızgara üzerinde A* ile
  yönlendirilir (`routeAll` → `src/ui/editor/routing.ts`). Eleman gövdeleri engeldir. Başka netin
  kablosuyla üst üste binme, köşe paylaşma, kesişme ve büküm cezalandırılır. Aynı netin kabloları
  hattı paylaşabilir.
- [x] **Kablo elle şekillendirilemez.** Seçili kablonun parça tutamaçları sürüklenebilir. Ara
  noktalar `Wire.points` içinde saklanır. "Otomatik güzergâh" düğmesi kabloyu otomatiğe döndürür.
- [x] **Bağlantı noktası (junction) yok.** Kablo ucu başka bir kablonun ortasına bırakılınca
  bağlantı noktası oluşur ve kablo ikiye bölünür. Kablosu kalmayan bağlantı noktası kendiliğinden
  silinir.

### Bileşenler ve simülasyon

- [x] **Bileşen parametreleri düzenlenemez.** Özellikler panelinde düzenlenebilen parametreler:
  termik ve şalter ayar akımı ile ısıl zaman sabiti; motor nominal akımı, hızı, yükü, kalkış oranı
  ve zaman sabitleri; kontaktör bobin gerilimi ve çekme/bırakma süreleri; lamba gerilimi ve rengi;
  PLC scan süresi.
- [x] **Kısa devre sadece uyarı olarak gösterilir.** Kısa devrede, arızayı ayırabilen koruma
  elemanlarından devrenin en büyük kısmını enerjili bırakanı açar. Bu eleman bir otomatik sigorta
  (yeni), bir motor koruma şalteri (manyetik açma) ya da akım sınırlamasına geçen güç kaynağı
  olabilir. Olaylar durum çubuğunda ve Özellikler › Proje altında listelenir. Koruma elemanı yoksa
  eski uyarı gösterilir.
- [x] **Motor koruma şalteri sadece elle açılıp kapanır.** Aşırı akımda (termik, I² modeli) ve kısa
  devrede kendiliğinden açar. Soğumadan tekrar kapatılamaz.
- [x] **Gerilim seviyeleri sınırlı.** Şebekeye N eklendi. Bobinler ve lambalar 24 V DC veya 230 V AC
  seçilebilir. Yanlış gerilimde çekmez, arıza verir (ör. 24 V bobin 230 V'ta, 230 V lamba 400 V'ta).
- [x] **Kütüphane kod içinde tanımlı.** Kütüphanedeki "Kullanıcı" kategorisinden yeni bileşen
  tanımlanabilir. Bileşen; bobin, bobinle çalışan NO/NC kontak, elle basılan NO/NC, lamba ve köprü
  kutuplarından oluşur. Tanım proje dosyasında saklanır. Tanım değişince şemadaki örnekler
  güncellenir.

### Editör

- [x] **Çoklu seçim yok.** Kutu ile seçim mümkün: soldan sağa çizilen kutu içindekileri, sağdan
  sola çizilen kutu değdiklerini seçer. Shift/Ctrl+tık seçime ekler veya çıkarır. Ctrl+A tümünü
  seçer. Grup taşıma, döndürme ve silme var. Ctrl+C/X/V ile kopyala, kes, yapıştır (imleç
  konumuna), Ctrl+D ile çoğalt.
- [x] **Sayfa yapısı yok.** Çok sayfalı proje var: sayfa sekmeleri, ekleme, yeniden adlandırma
  (çift tık) ve silme. Her sayfada çerçeve ve antet (proje adı, sayfa adı, sayfa no) bulunur. Aynı
  adlı "Sayfa geçişi" elemanları elektriksel olarak bağlıdır ve karşı sayfa numarasını gösterir.
  Çift tıklayınca karşı sayfaya gidilir.
- [~] **Dar ekran desteği zayıf.** Dokunmatikte tek parmak kaydırır, iki parmak yakınlaştırır.
  Terminal yakalama yarıçapı büyür. Kütüphaneden sürükle-bırak yerine "tıkla, sonra alana tıkla"
  ile yerleştirme yapılabilir. Dar ekranda (≤ 760 px) çizim alanı tam ekrandır. Kütüphane,
  Özellikler ve PLC paneli alttaki sekmelerden açılan çekmecelerdir. Kütüphaneden eleman seçilince
  çekmece kapanır. Dokunmatikte hedefler büyür, iOS'un form alanında otomatik yakınlaştırması
  engellenir, çentik/home çubuğu boşlukları bırakılır. **Gerçek bir dokunmatik cihazda henüz test
  edilmedi** (yalnız Chrome mobil emülasyonu).

## Kalan sınırlar (v0.3)

- [ ] **Mantıksal çözücü akım hesaplamaz.** Kısa devre, aynı nette iki farklı potansiyel olarak
  algılanır. Termik ve şalterin gördüğü akım yalnız motor modelinden gelir; lamba ve bobin akımı
  hesaba katılmaz.
- [ ] **Koruma seçiciliği sezgiseldir.** Açılacak eleman, devrenin en büyük kısmını enerjili
  bırakan elemandır. Gerçek açma eğrileri ve kademelendirme modellenmez.
- [ ] **Kullanıcı kütüphanesi projeye bağlı.** Tanımlar proje dosyasında saklanır. Projeler arası
  ortak kütüphane veya içe aktarma yok. Kullanıcı bileşeninin sembolü kutup türlerinden üretilir,
  serbest çizilemez.
- [x] **Ladder komut seti dar.** Komut kütüphanesi eklendi (`src/sim/instructions.ts`): NO/NC,
  yükselen/düşen kenar (P/N) kontakları, karşılaştırma (==, <>, >, >=, <, <=), bobin, ters bobin,
  set, reset; TON, TOF, TP, TONR zamanlayıcıları (T0..T15) ve CTU, CTD, CTUD sayıcıları (C0..C15).
  Komutlar ladder editörünün solundaki ayrı "PLC komutları" menüsünden sürüklenir veya tıklanır
  (şema kütüphanesinde yer almazlar; çizim alanına bırakılamazlar).
- [ ] **Sayısal veri işlemleri yok.** MOVE, aritmetik ve %MW kelime belleği yok; karşılaştırma
  yalnız sabit, zamanlayıcı geçen süresi ve sayıcı değeriyle yapılır. Zamanlayıcı/sayıcı belleği
  kalıcı değildir (PLC beslemesi kesilince sıfırlanır).
- [ ] **Kablo yönlendirme sayfa bazında sırayla yapılır.** Önce çizilen kablo en iyi yolu alır.
  Çok yoğun sayfalarda A* yol bulamazsa basit L/Z güzergâhına düşülür. Taşıma sırasında etkilenen
  kablolar basit güzergâhla önizlenir.
- [ ] **Sayfalar arası taşıma yok.** Bir eleman kesip başka sayfaya yapıştırılarak taşınabilir.
  Bu durumda dış kabloları kaybolur.
  