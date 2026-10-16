# PLC-SIM → Eğitim Modülü

Bu dosyada plc-sim'i bir eğitim modülüne dönüştürme fikirlerini ve aldığımız kararları tutuyoruz.
Kararlar en altta, **Kararlar** bölümünde.

## Ürün tanımı (2026-10-16)

- **Kime:** Kendi başına pratik yapmak isteyen **MYO öğrencisi** ve **üniversite 1. sınıf öğrencisi**
  (elektrik, mekatronik, otomasyon). Öğretmen, sınıf ve okul lisansı bu sürümün kapsamında değil.
- **Ne:** Elektrik temelinden ileri seviyeye uzanan, adım adım bir PLC eğitimi.
- **Odak: "Hayal ettirme, göster."** Öğrenci ladder'a bakıp makinenin ne yaptığını kafasında
  canlandırmak zorunda kalmamalı. Her ders ve görevde programın sürdüğü makine ekranda canlı
  çalışır: trafik lambası yanar, bariyer kalkar, kutu bantta ilerler, tank dolar. Ladder ile
  makine aynı anda görünür; bir kontak kapanınca sahnede neyin değiştiği hemen fark edilir.

### Görsellik ilkesi: her içerik için kontrol listesi

1. Görevin bir **canlı sahnesi** var. Çıktı yalnız bir lamba ya da %Q biti değil, gerçek
   hayattan tanıdık bir mekanizma (kavşak, bariyer, kapı, bant, asansör, tank).
2. Sahne **ladder ile yan yana** görünür; öğrenci pencere değiştirmeden ikisini birlikte izler.
3. Girişler sahnenin içinden verilir: araç sensöre gelir, kutu fotoselin önünden geçer. Öğrenci
   yalnız %I bitine tıklamak zorunda kalmaz.
4. Hata da görünür: yanlış programda bariyer araca iner, iki yön aynı anda yeşil yanar. Senaryo
   denetimi "geçmedi" demekle kalmaz, sahnede neyin ters gittiğini gösterir.
5. Zaman kavramı (zamanlayıcı, sıra) sahnede okunabilir: kalan süre ve aktif adım görünür.

## Elimizde zaten olanlar

- **Görev modu**: açıklama ve senaryo dili (`bas S1`, `bekle ... en fazla 5 s`, `kontrol ... boyunca 2 s`). "Kontrol et" ile otomatik değerlendirme yapıyor. Bu, otomatik notlandırmanın temeli olabilir.
- **7 hazır görev**: fan, konveyör, yıldız-üçgen, asansör, garaj kapısı, PID seviye, pick & place.
- **Arıza enjeksiyonu**: arızalar öğrenciden gizlenebiliyor, yani arıza bulma alıştırması hazır.
- **Trend, online izleme, I/O tablosu**: öğrenci gözlem yapıp yorum yazabilir.
- **Kurulum gerektirmiyor**: GitHub Pages'te çalışıyor ve mobilde de açılıyor.
- **Simüle alıcı panelleri** (gerçek kullanıcı değil, yalnız itirazları bulmak için):
  - Simülatörün kendi paneli (`founder/panel/results.md`): **0/40 satın alma**, ayrıca 100 kişiden 60'ının cevabı eksik. Vazgeçme nedenleri: fiyat, ihtiyaç, Siemens alışkanlığı, güven.
  - Canlı kurs paneli (`founder/course/results.md`, "PLC-SIM Akademi"): %30 satın alma. Bu oran simülatöre değil canlı derse ait. Vazgeçme nedenleri: güven, alışkanlık ("yarıda bıraktım"), fiyat ve "TIA Portal yok".

## Fikirler

### 1. Müfredat iskeleti (seviyeli yol haritası)

Konuları seviyelere ayırıp her birini **ders, örnek ve görev** üçlüsüyle kurmak:

| Seviye | Konular | Mevcut görev / örnek |
|---|---|---|
| 0: Elektrik temeli | Potansiyel, NO/NC, kontaktör, mühürleme (röle mantığıyla) | Start-stop örneği |
| 1: PLC'ye giriş | Scan cycle, I/Q adresleme, ara röle neden gerekir | Fan start-stop |
| 2: Temel komutlar | Set/Reset, kenar, zamanlayıcı, sayıcı | Konveyör, yıldız-üçgen |
| 3: Sıralı kontrol | Adım/durum makinesi, kilitlemeler | Garaj kapısı, asansör, pick & place |
| 4: Analog ve PID | Ölçekleme (0..27648), SCALE, PID ayarı | PID seviye kontrolü |
| 5: Haberleşme | Modbus RTU, sürücü kumandası, HSC/enkoder | Frekans konvertörü örnekleri |
| 6: Arıza bulma | Gizli arızalar, ölçüm ve izleme ile teşhis | Arıza enjeksiyonu |
| 7: Bitirme projesi | Birden çok sayfalı tam bir hat | Yeni |

### 2. Ders formatı (uygulama içinde)

- **Ders paneli**: Görev panelinin yanında kısa metin ve görseller, adım adım "şimdi şunu yap" yönergeleri.
- **Rehberli mod**: Her adımda o adıma ait mini senaryo koşar ve yeşil yanınca sonraki adım açılır.
- **İpucu kademeleri**: 1. ipucu yön gösterir, 2. ipucu ilgili komutu söyler, 3. ipucu çözüm şemasının bir parçasını gösterir. Kullanılan ipucu puanı düşürür.
- **Hazır başlangıç şeması**: Görevler boş sayfayla değil, kısmen kurulmuş bir şemayla başlar. Böylece öğrenci yalnız konunun özüne odaklanır.

### 3. Değerlendirme ve ilerleme

- Senaryo sonuçlarından puan çıkarmak: geçen satır sayısı, süre, kullanılan ipucu.
- Öğrenci profili (önce tarayıcıda, sonra hesapla): tamamlanan görevler ve rozetler.
- **Tamamlama belgesi**: Görev senaryolarının geçtiğini gösteren, doğrulama kodlu bir PDF.
- Arıza bulma sınavı: Rastgele bir gizli arıza seçilir ve öğrenci süre içinde bulup işaretler.

### 4. Öğretmen tarafı (okul lisansı): *ertelendi, bu sürümün kapsamında değil*

- Sınıf oluşturma ve ödev olarak görev atama (paylaşılabilir görev linki veya `.plcsim.json`).
- Öğrenci ilerleme tablosu: kim hangi görevi geçti, kaç denemede.
- **Görev editörü**: Öğretmen kod yazmadan kendi görevini ve senaryosunu yazar.
- Sınav modu: ipucu kapalı, süre sınırlı, arızalar gizli.

### 5. "TIA Portal yok" itirazına cevap

Satın alma panelindeki en sert itiraz buydu.

- Ladder'ı Siemens adres ve komut adlarına birebir benzetmek (zaten %I/%Q/%IW, MOVE, SCALE ve PID var). Farkları bir "TIA'da bu nasıl" kutusunda göstermek.
- Bitirme projesinin TIA Portal'a nasıl aktarılacağını anlatan bir rehber. İleride SCL/AWL dışa aktarımı da düşünülebilir.
- Konumlandırmayı "TIA'nın yerine" değil, "TIA'dan önce, kurulum ve lisans olmadan mantığı oturtma laboratuvarı" olarak yapmak.

### 6. Ürün ve iş modeli seçenekleri: *ertelendi; ilk sürüm ücretsiz ve bireysel öğrenciye yönelik*

- **A. Kendi temposunda kurs** (uygulama içi dersler ve görevler; ücretsiz ilk 2 seviye, sonrası Pro). Panelde "canlı derse yetişemem" diyenlere hitap eder.
- **B. Canlı kurs ve laboratuvar** (PLC-SIM Akademi). Canlı dersi sevenlerde satın alma oranı %75, ama güven sorunu var.
- **C. Okul ve MYO lisansı**: öğretmen paneli ve müfredata uygun görev paketleri.
- **D. Karma model**: ücretsiz çekirdek, ücretli görev paketleri ve belge, okul lisansı.
- Güven için: eğitmenin adı ve saha geçmişi, ücretsiz bir YouTube serisi (simülatörde çözülen görevler), ilk kursiyerlerden yorum.

### 7. Teknik işler (kabaca)

- Ders/görev içerik formatı: `tasks.ts` yerine JSON veya Markdown dosyaları ile senaryo ve başlangıç şeması.
- Ders paneli ve rehberli adımlar (UI).
- İlerlemenin kaydı: önce localStorage, sonra backend (hesap, sınıf).
- PDF belge ve doğrulama sayfası.
- Görev editörü (senaryo dili için arayüz).

## Seviye planı (ilk sürüm)

Her seviye bir **çıkış senaryosu** ile biter. Bu senaryo sabittir ve seviyenin son görevidir. Öğrenci onu geçince sonraki seviye açılır. Rastgele senaryo üretimi daha sonra eklenecek. Mevcut görevler kalın yazılı, geri kalanlar yeni.

| Seviye | Ders | Görev | Dersler | Görevler (son satır = çıkış senaryosu) |
|---|---:|---:|---|---|
| **Başlangıç**: elektrik ve röle mantığı | 4 | 3 | 1. Devre, potansiyel, 24 V / 230 V · 2. NO/NC, buton, lamba · 3. Kontaktör ve mühürleme · 4. Koruma: sigorta, termik | Lamba yakma (buton ve kontaktör) · Röle ile start-stop mühürleme · *Çıkış:* kilitlemeli ileri-geri motor (röle mantığıyla) |
| **Temel**: PLC'ye giriş ve komutlar | 5 | 4 | 1. PLC nedir, scan cycle, %I/%Q · 2. Ladder, ara röle neden gerekir · 3. Set/Reset ve kenar · 4. Zamanlayıcılar · 5. Sayıcılar | **Fan start-stop** · **Konveyör: fotoselde dur** · Kutu sayma (sayıcı) · *Çıkış:* **Yıldız-üçgen yol verme** |
| **Orta**: sıralı kontrol | 4 | 4 | 1. Adım mantığı ve durum makinesi · 2. Kilitlemeler ve emniyet (acil stop) · 3. Limit switch ve konum sensörleri · 4. Pnömatik sıralama | **Garaj kapısı** · Pnömatik A+ B+ A− B− sırası · **Pick & place çevrimi** · *Çıkış:* **Asansör: 3 kat** |
| **İleri**: analog, PID, haberleşme | 5 | 4 | 1. Analog sinyal, 0–10 V, 4–20 mA, 0..27648 · 2. SCALE ve karşılaştırma · 3. PID ve ayar · 4. Hızlı sayıcı ve enkoder · 5. Modbus RTU ve frekans konvertörü | Tank seviyesi alarmı (analog eşik) · **PID seviye kontrolü** · Lineer eksen konumlama (enkoder) · *Çıkış:* Modbus ile konveyör hız kontrolü |
| **Saha Senaryoları**: arıza bulma ve bitirme | 3 | 4 | 1. Arıza bulma yöntemi (ölç, izle, ayır) · 2. Online izleme ve trend ile teşhis · 3. Proje yapısı: sayfalar, klemens, adlandırma | Arıza bulma 1: gizli bobin ve kontak arızası · Arıza bulma 2: kopuk kablo ve sensör arızası · Arıza bulma 3: süreli, birden çok arıza · *Çıkış:* bitirme projesi (çok sayfalı dolum ve paketleme hattı) |
| **Toplam** | **21** | **19** | | 7 mevcut, 12 yeni görev |

Sayıların mantığı:
- Bir ders 5–10 dakikalık bir metin ve küçük bir deneme adımından oluşur. Seviye başına 3–5 ders, MYO öğrencisi için bir haftalık tempo eder.
- Seviye başına 3–4 görev var ve bunların sonuncusu çıkış senaryosu.
- Başlangıç ve Saha seviyelerinde hiç mevcut görev yok, bu yüzden yeni yazılması gereken görevler en çok bu iki seviyede.

### Canlı sahne ihtiyacı (görsellik ilkesine göre)

Mevcut sahneler: lamba, motor, fan, konveyör (kutu), pnömatik silindir, pick & place, asansör,
garaj kapısı, tank, fırın, lineer eksen, ekskavatör kolu. Yeni sahne önerileri (karar değil,
tartışılacak):

| Sahne | Seviye | Öğrettiği | Durum |
|---|---|---|---|
| Trafik lambası (tek yön, sonra kavşak + yaya butonu) | Temel | Zamanlayıcı, sıralama, TON zinciri | **Hazır**: tek yön (`trafficLight`, Temel görevi `task-traffic`) ve kavşak + yaya ışığı + yaya butonu (`trafficJunction`, Orta görevi `task-junction`) |
| Butonlu yaya geçidi (iki yönlü yol, BEKLEYİN lambası) | Orta | Talep hafızası (Set/Reset), en az yeşil süresi, temizleme süresi | **Hazır** (`pedCrossing`, Orta görevi `task-crossing`) |
| Otopark bariyeri (araç sensörü, kol, giriş/çıkış sayacı, "dolu" lambası) | Temel / Orta | Sayıcı, limit switch, emniyet kilidi (kol araca inmez) | Yeni bileşen |
| Dolum hattı (bant + şişe + dolum valfi + seviye) | Saha (bitirme) | Birden çok mekanizmanın sıralı çalışması | Bileşenler arası mekanik bağlantı gerekir (`BILINEN-SINIRLAR.md`) |

Başlangıç seviyesinin görevleri (lamba, start-stop, ileri-geri motor) mevcut lamba ve motor
görselleriyle karşılanıyor. Ancak motorun dönüş yönü sahnede açıkça görünmeli.

## İlerleme kaydı (ilk sürüm)

- İlerleme bir dosyaya yazılır: `.plcsim-ilerleme.json`. İçinde biten dersler, geçilen görevler, deneme sayısı, tarih ve öğrencinin son şeması bulunur.
- "İlerlemeyi kaydet" ve "İlerlemeyi yükle" düğmeleri olur. Öğrenci cihaz değiştirdiğinde dosyayı taşır.
- localStorage yalnızca kolaylık için kullanılır (sayfa yenilenince kaldığı yerden devam). Ana kayıt dosyadır.
- Dosya imzasız olacak. Ücretsiz ve belgesiz sürümde öğrencinin dosyayı elle değiştirmesi bir sorun yaratmıyor.

## Açık sorular

- Seviyeler sırayla mı açılacak, yoksa öğrenci bir seviyeyi atlayabilecek mi (ör. çıkış senaryosunu doğrudan çözerek)?
- Rastgele senaryo üretimi ne zaman yapılacak? Bunun için mevcut senaryo dili parametreli hâle getirilmeli.
- Kalıcı ilerleme kaydı için uzun vadeli çözüm ne olacak (hesap mı, bulut senkronu mu)?

## Eleştiri notları (2026-10-16)

- **Bireysel öğrenciyi öğretmen değil ürün motive etmeli.** Paneldeki en büyük ikinci vazgeçme nedeni "yarıda bıraktım" alışkanlığıydı. Kısa dersler, görünür ilerleme ve bir sonraki adımın hazır olması şart.
- **İki segment aynı değil.** MYO öğrencisi pano ve saha diliyle öğrenir. Yeni mezun mühendis ise iş görüşmesine ve TIA Portal'a odaklıdır ve panelde "oyuncak gibi" itirazını o getirdi. *(Sonuç: yeni mezun hedef kitleden çıkarıldı. Hedef, MYO ve üniversite 1. sınıf öğrencisi; bkz. Kararlar.)*
- **Seviye adları paralel değil.** "Başlangıç" ile "temel" birbirine çok yakın, "iyi" ölçülebilir değil. "Senaryolar" ise konu değil bir alıştırma türü. Öneri: Başlangıç (elektrik ve röle mantığı), Temel (PLC giriş ve komutlar), Orta (sıralı kontrol), İleri (analog, PID, haberleşme), Saha Senaryoları (arıza bulma ve bitirme projesi). Her seviyede ayrıca kendi senaryo görevleri olur.
- **"Müfredat yok" aslında "müfredatı biz yazıyoruz" demek.** Her seviye için kendi öğrenme çıktılarımızı yazmamız gerekiyor. Güven için de iş ilanlarında ve mülakatlarda sorulan konularla (S7-1200 mantığı) eşleştirilmesi faydalı olur.

## Kararlar

| Tarih | Karar | Gerekçe |
|---|---|---|
| 2026-10-16 | ~~İlk hedef kitle MYO/okul: öğretmen ve sınıf~~ (aynı gün geri alındı) | |
| 2026-10-16 | ~~İlk sürümde öğretmen-öğrenci ilişkisi yok. Hedef kitle bireysel MYO öğrencisi ve yeni mezun mühendis~~ (aşağıdaki hedef kitle kararıyla değişti) | Öğretmen paneli ve ödev sistemi ilk sürümün dışında kalır. |
| 2026-10-16 | ~~5 seviye: başlangıç, temel, orta, iyi, senaryolar~~ (seviye adları kararıyla değişti) | |
| 2026-10-16 | Dış müfredat yok, **müfredatı biz belirliyoruz** | |
| 2026-10-16 | ~~Öncelikli segment MYO öğrencisi, yeni mezun mühendis ikincil~~ (aşağıdaki hedef kitle kararıyla değişti) | |
| 2026-10-16 | Seviyeler: **Başlangıç** (elektrik ve röle mantığı), **Temel** (PLC'ye giriş ve komutlar), **Orta** (sıralı kontrol), **İleri** (analog, PID, haberleşme), **Saha Senaryoları** (arıza bulma ve bitirme projesi). Her seviyede ayrıca senaryo görevleri var. | Yukarıdaki "başlangıç, temel, orta, iyi, senaryolar" kararının yerini alır. Adlar paralel ve her biri bir konuya karşılık geliyor. |
| 2026-10-16 | İlk sürüm **ücretsiz**, belge ve lisans kontrolü yok | Tarayıcıda çalışan, sunucusuz bir sürümde ikisi de doğrulanamaz. |
| 2026-10-16 | Çıkış kriteri **senaryo**: her seviyenin sabit bir çıkış senaryosu var, rastgele senaryo üretimi daha sonra | Mevcut görev modu ve senaryo dili bunu bugün destekliyor. |
| 2026-10-16 | İlerleme **dosyaya kaydedilir** (`.plcsim-ilerleme.json`), localStorage yalnız kolaylık için | Sunucu yok, kalıcı çözüm şimdilik belirsiz. Dosya cihazlar arasında taşınabiliyor. |
| 2026-10-16 | Ders ve görev sayıları: Başlangıç 4/3, Temel 5/4, Orta 4/4, İleri 5/4, Saha 3/4 (toplam 21 ders, 19 görev) | Ayrıntısı "Seviye planı" bölümünde. |
| 2026-10-16 | Üst çubukta **🎓 Öğren** düğmesi: eğitim yolu ekranını açar (seviyeler, ilerleme, "Devam et"). Seçilen ders veya görev şemasını yükler ve çizim alanında **eğitim kartı** açılır. | Önceki sürümde eğitim, Örnek menüsünde ve alt paneldeki Görev sekmesinde dağınıktı; öğrenciye ne yapacağını söyleyen bir akış yoktu. |
| 2026-10-16 | Ders adımları **canlı denetlenir**: öğrenci istenen işi yapınca (lamba yandı, kablo eklendi, parametre değişti) adım tamamlanır ve "İleri" açılır. Takılan için "Adımı atla" var. | Öğrenci yaptığını anında görür, okuyup geçmek yerine dener. |
| 2026-10-16 | Seviyeler **sırayla açılır**: önceki seviyenin çıkış görevi geçilince. Seviye içindeki öğeler serbest sırada. Çıkış görevi henüz yazılmamışsa seviye engellemez. | Açık sorulardaki "seviye atlama" sorusuna geçici cevap; değiştirilebilir. |
| 2026-10-16 | İlk yazılan içerik: Başlangıç (4 ders + 3 yeni PLC'siz görev) ve Temel (5 ders + mevcut 3 görev). Orta ve İleri'de mevcut görevler açık, dersler "Yakında". Saha seviyesinin tamamı "Yakında". | Önce akışın kendisini denemek için. |
| 2026-10-16 | Ders anlatımı **uygulama içi metin** (ders paneli, rehberli adımlar) | Video ve canlı ders gerektirmiyor. Öğrenci tek başına, öğretmen olmadan ilerleyebilmeli. |
| 2026-10-16 | İlk sürüm **yalnız tarayıcıda** çalışır, hesap ve backend yok | GitHub Pages'te kalır, okulda kurulum ve KVKK yükü olmaz. İlerleme localStorage'da ve dışa aktarılan dosyalarda tutulur. |
| 2026-10-16 | **Hedef kitle:** kendi başına pratik yapan **MYO ve üniversite 1. sınıf öğrencisi**. Yeni mezun mühendis, öğretmen ve okul kapsam dışında. | Tek bir kitleye göre ders dili ve zorluk netleşir. Öğretmen olmadığı için öğrenciyi ürünün kendisi motive etmeli. |
| 2026-10-16 | **Ana odak görsellik:** her ders ve görevde programın sürdüğü mekanizma ladder ile yan yana, canlı görünür (bkz. "Görsellik ilkesi"). Yeni içerik yazılırken önce sahne seçilir. | Öğrencinin en çok zorlandığı yer, ladder'dan makinenin davranışını hayal etmek. Bu aynı zamanda YouTube videolarından ve "oyuncak" algısından ayrışma noktası. |
| 2026-10-16 | İlk canlı sahne **trafik ışığı** (tek yön). Sinyal kafası LED sürücü kartlıdır: R/Y/G sinyal girişidir, PLC çıkışına röle olmadan bağlanır. Temel seviyede Zamanlayıcılar dersinden sonra "Trafik ışığı" görevi var. | Zamanlayıcı dersinde öğrencinin 3 ara röle kablolaması ile uğraşmaması için. "PLC çıkışı yük beslemez" kuralı lamba, fan ve valf için geçerli kalır. |
| 2026-10-16 | **Kavşak** sahnesi: A ve B yolu, A yolunda yaya geçidi, yaya ışığı ve butonu. Sürücüler yalnız ışığa uyar, yayaya ayrıca yol vermez; hatalı programda çakışma, kaza riski ve yaya tehlikesi sahnede görünür. Görev Orta seviyede (sıralı kontrol + talep hafızası). | Hatanın sonucunu görmek, "kontrol başarısız" yazısından daha öğretici. Yayaya yol veren sürücü modeli hatalı programı gizliyordu. |
| 2026-10-16 | **Butonlu yaya geçidi** sahnesi: iki yönlü yol, iki kaldırım, BEKLEYİN lambası. Görev Orta seviyede, kavşaktan önce: talep hafızası, en az araç yeşili ve temizleme süresi. | Kavşaktan daha küçük bir adım: aynı sıralama fikri, tek araç ışığı. Temizleme süresi "yaya zebradayken araç geçti" uyarısıyla görünür hâle geliyor. |
| 2026-10-16 | Ücretli kademe, Pro, okul lisansı ve sertifika **ertelendi**. `founder/pricing.md` ileride kullanılmak üzere duruyor. | İlk sürüm ücretsiz (yukarıdaki karar). Simülatör panelinde satın alma 0/40; önce gerçek öğrenci kullanımı ölçülmeli. |
