## 0.4.144 — 25 Eylül 2026

### VotexArtemis ayrı kurulum paketi

- VotexArtemis ayrı program: VotexArtemis.iss ile ayrı AppId, ayrı kurulum klasörü; DFT Suite'e dokunmaz.
- build_single_setup.py --artemis modu: hafif paket (votex.exe + resources), koşullu runtime kurulumu, ayrık %APPDATA%\VotexArtemis veri dizini.
- Not: 0.4.143 NSIS ağı hatasından (os error 10051) sonra bu commitle birlikte yeniden üretildi.
- VOTEX 0.4.144 Windows setup üretildi.

## 0.4.143 — 25 Eylül 2026

### VotexArtemis ayrı kurulum paketi

- VotexArtemis artık ayrı bir program olarak kuruluyor: VotexArtemis.iss ile ayrı AppId, {autopf}\VotexArtemis klasörü, masaüstü/Başlat kısayolları; mevcut DFT Suite / VOTEX / DTA kurulumlarına dokunmaz, eski kaldırıcıları çalıştırmaz, süreç kapatmaz.
- build_single_setup.py --artemis modu: yalnız votex.exe + resources stage edilir, VotexArtemis.exe olarak adlandırılır, runtime'lar (VC++/WebView2/Node/Rust) sistemde yoksa koşullu kurulur, setup meta votex_artemis_setup_meta.json'a yazılır.
- Kullanıcı verileri %APPDATA%\VotexArtemis altında ayrık; birinci çıktı KURULUM_PAKETLERI\VotexArtemis_<sürüm>_Kurulum.exe (58 MB, DTA'sız hafif paket).
- VOTEX 0.4.143 Windows setup üretildi.

## 0.4.142 — 25 Eylül 2026

### DTA köprü canlı doğrulama ve outbox ucu

- Köprüye POST /dta/chat/outbox eklendi: panel→DTA mesajı artık HTTP üzerinden de yazılabiliyor; canlı doğrulama ve dış araç entegrasyonu için test yolu.
- Paketleme kaynağı (DTA_SRC) senkronlandı: votex_chat.py ve main.py panel sohbet desteğiyle artık setup'a giriyor.
- Canlı doğrulama: DTA+VOTEX birlikte başlatıldı; heartbeat, chat push, since-cursor ve ack akışı uçtan uca doğrulandı.
- VOTEX 0.4.142 Windows setup üretildi.

## 0.4.141 — 25 Eylül 2026

### DTA köprü canlı doğrulama ve outbox ucu

- Köprüye POST /dta/chat/outbox eklendi: panel→DTA mesajı artık HTTP üzerinden de yazılabiliyor; canlı doğrulama ve dış araç entegrasyonu için test yolu.
- Paketleme kaynağı (DTA_SRC) senkronlandı: votex_chat.py ve main.py panel sohbet desteğiyle artık setup'a giriyor.
- Canlı doğrulama: DTA+VOTEX birlikte başlatıldı; heartbeat, chat push, since-cursor ve ack akışı uçtan uca doğrulandı.
- VOTEX 0.4.141 Windows setup üretildi.

## 0.4.140 — 25 Eylül 2026

### DTA köprü canlı doğrulama ve outbox ucu

- Köprüye POST /dta/chat/outbox eklendi: panel→DTA mesajı artık HTTP üzerinden de yazılabiliyor; canlı doğrulama ve dış araç entegrasyonu için test yolu.
- Paketleme kaynağı (DTA_SRC) senkronlandı: votex_chat.py ve main.py panel sohbet desteğiyle artık setup'a giriyor.
- Canlı doğrulama: DTA+VOTEX birlikte başlatıldı; heartbeat, chat push, since-cursor ve ack akışı uçtan uca doğrulandı.
- VOTEX 0.4.140 Windows setup üretildi.

## 0.4.139 — 25 Eylül 2026

### DTA panel sohbet kalıcılığı

- DTA panel sohbet geçmişi vaka oturumuna eklendi: konuşma turları fingerprint anahtarlı saha oturumuyla saklanır, arşivden aynı JSON tekrar açıldığında sohbet geri yüklenir.
- Rust halkası + oturum geri yüklemesi çift kayıt üretmez: rol+metin imzası ile dedup; en fazla 100 tur saklanır.
- Yeni vakada sohbet sıfırlanır; eski oturum kayıtları (dtaChat alanı olmadan) geriye uyumlu açılır.
- VOTEX 0.4.139 Windows setup üretildi.

## 0.4.138 — 25 Eylül 2026

### DTA panel hedef kısayolları

- DTA sohbet paneline hedef kartı kısayolları eklendi: '3D'deki 2. hedefi açıkla' gibi saha soruları tek tıkla Jarvis'e gider.
- Kısayol sırası paneldeki BİRLEŞİK HEDEFLER kartlarıyla birebir aynıdır (ÖNCE İNCELE/ADAY); paralel numaralandırma üretilmez.
- Tüm hedeflere ek olarak 'Özet' kısayolu ekler; çipler vaka değişince kendiliğinden tazelenir.
- VOTEX 0.4.138 Windows setup üretildi.

## 0.4.137 — 25 Eylül 2026

### DTA sohbet paneli köprüsü

- VOTEX 3D altına yarı saydam DTA sohbet paneli eklendi: konuşma turları ve panel mesajları localhost köprüsünde akar.
- Rust köprüsüne POST /dta/chat, GET /dta/chat/since ve GET /dta/chat/pending uçları + sohbet halkası (son 100 tur) eklendi; DTA konuşma turu bitince kullanıcı sözü ve asistan yanıtı panele itilir.
- DTA arka planda 2 saniyede bir panel mesajlarını çekip Jarvis'e iletir; köprü kapalıysa kuyrukta bekletir.
- Daha önce konuşma verisi API'den geçmiyordu; panel için yeni sohbet uçları eklendi, ipucu/durum uçları değişmedi.
- VOTEX 0.4.137 Windows setup üretildi.

## 0.4.136 — 25 Eylül 2026

### JSON dik taramada termal isteği kapat

- DTA'ya aktarılan Legacy3DMAG JSON dik tarama özetinde termal sensör doğrulaması istenmemesi açıkça belirtildi.
- İstisna yalnız JSON dik tarama bağlamına uygulanır; diğer ELIC analizleri aynı kalır.
- VOTEX 0.4.136 Windows setup üretildi.

## 0.4.135 — 25 Eylül 2026

### DTA arşiv karar açıklığı

- Benzer kabul ve ret kararlarını kapsayan arşiv bağlamı için kullanıcıya gösterilen ifade netleştirildi.
- VOTEX 0.4.135 Windows setup üretildi.

## 0.4.134 — 25 Eylül 2026

### DTA benzer vaka bağlamı

- DTA vaka özetine, kullanıcı seçimiyle arşivden benzer doğrulanmış operatör kararları eklenebilir.
- Benzerlik eşleştirmesi model eğitimi veya teşhis değildir; arşiv kimlikleri aktarılmaz.
- VOTEX 0.4.134 Windows setup üretildi.

## 0.4.133 — 25 Eylül 2026

### JSON hedef kesiti

- Legacy JSON aday kartlarına ölçüm gridinden X/Y kesit profili eklendi.
- Ölçülmemiş hücreler boş bırakılır; model derinliği ölçüm profilinden ayrı gösterilir.
- VOTEX 0.4.133 Windows setup üretildi.

## 0.4.132 — 24 Eylül 2026

### Sürüm güncellemeleri

- JSON 3D aday karşılaştırma görünümü
- VOTEX 0.4.132 Windows setup üretildi.

## 0.4.131 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.131 Windows setup üretildi.

## 0.4.130 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.130 Windows setup üretildi.

## 0.4.129 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.129 Windows setup üretildi.

## 0.4.128 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.128 Windows setup üretildi.

## 0.4.127 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.127 Windows setup üretildi.

## 0.4.126 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.126 Windows setup üretildi.

## 0.4.125 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.125 Windows setup üretildi.

## 0.4.124 — 24 Eylül 2026

### Sürüm güncellemeleri

- Bakım sürümü.
- VOTEX 0.4.124 Windows setup üretildi.

## 0.4.123 — 24 Eylül 2026

### Hassasiyet çubuğu yeniden tasarımı: kademe + keşif

- ONAYLI/ADAY kademe modeli: yüksek oranlı tespitler (z-skor ≥ 2σ veya güven ≥ 0.75) hassasiyet eşiğinden muaftır — çubuk kısalsa da asla silinmezler.
- Çubuk artık keşfi yönetir: tohum eşiği manyetik genlik z-skoruna bağlı (2.5σ ↔ 1.0σ); bitişik tohumlar birleşerek yapı olur, alan filtresi birleşik yapıda uygulanır ve kümeler şekil sınıflanır (metal/oda/tünel/boşluk).
- Silme yerine soldurma: 3D'de kademe görselleri (ONAYLI parlak, ADAY saydam, gürültü soluk), panelde kırılım sayacı (●onaylı · ◌aday · elendi).
- Rust yapı motorunda hysteresis muafiyeti (build/validate/mod kapıları) — JS/Rust parite testleri genişletildi.

## 0.4.122 — 24 Eylül 2026

### Paketleme öncesi arayüz sağlık kontrolü

- build_single_setup.py'e zorunlu arayüz sağlık kontrolü eklendi: tag dengesi ve main.layout panel düzeni sözleşmesi (panel-ops · panel-stage · panel-intel) bozuksa paketleme baştan durur.
- scripts/uiHealth.test.js ile 5 regresyon testi; --check-ui ile tek başına çalıştırılabilir.

## 0.4.121 — 24 Eylül 2026

### Arayüz düzeni düzeltmesi

- index.html'deki kapanmamış etiketler düzeltildi: TOPRAK katlaması (details) CFG/LOG/MAP panellerini ve orta/sağ panelleri yutup ekrandan taşıyordu; arayüz 3 panelli düzene geri döndü.
- Fazladan kapanan div ve erken kapanan label etiketi de temizlendi.
- VOTEX 0.4.121 Windows setup üretildi.

## 0.4.120 — 24 Eylül 2026

### Paketleme düzeltmesi

- 0.4.119 kurulum paketi, eşzamanlı derleme yarışı yüzünden eski (0.4.118) Votex.exe'yi paketlemişti; temiz 0.4.120 derlemesi + paket içi hash doğrulaması.

## 0.4.119 — 24 Eylül 2026

### Release otomasyonu

- Sürüm artırma + doğrulama + NSIS + birleşik setup akışı tek komuta indirildi: npm run release (scripts/release.mjs).
- Sürüm senkronizasyonu birim testleri eklendi (scripts/release.test.js).
- VOTEX 0.4.119 Windows setup üretildi.

## 0.4.118 — 24 Eylül 2026

### Hassasiyet hattı tamamlandı: 3D bağ, canlı sayaç, kalıcılık, tek kaynak

- Hassasiyet ayarı 3D analiz hattına (`build_surface_3d`) da bağlandı: min güven skoru %0→0.80 ↔ %100→0.15 eşlemesiyle Rust'a iletilir; JS/Rust eşik formülleri `ui/hybrid/sensitivity.js` ve `src-tauri/src/sensitivity.rs` ile ortak tanımlandı (Rust birim testleri dahil).
- Çift `min-confidence` id çakışması giderildi: hassasiyet slider'ı `main-sensitivity-slider` oldu, eski 25-70 "Min. güven" slider'ı kaldırıldı; arşiv geri yükleme ve AUTO artık kayıtlı min güveni ters eşlemeyle hassasiyet slider'ına yazar.
- Birleşik Analiz panelinde hassasiyet gerçek tespit filtresine bağlandı: renk eşleşme toleransı + min piksel alanı görüntü çözümlemeye, güven eşiği yapı tespitine uygulanır; 3D yapı kutuları süzgeçten geçer ve slider yanında canlı tespit sayacı gösterilir.
- Hassasiyet artık kalıcı: analiz oturumu (`AnalyzeSession`) ve arşiv meta/index girdileri `sensitivity` alanını saklar (eski kayıtlar uyumlu); arşiv açılışında slider doğrudan geri gelir ve saha raporu altbilgisine "Hassasiyet: %X (etiket) · min güven · eşik · min alan" satırı yazılır.
- Hassasiyet→eşik katsayıları tek kaynakta birleştirildi: `shared/sensitivity.json` hem JS hem Rust tarafından okunur; ortak `golden` vektörleri iki dildeki birim testlerle pariteyi kilitler.
- VOTEX 0.4.118 Windows setup üretildi.

## 0.4.117 — 23 Eylül 2026

### Yapı tespit hassasiyeti ayar çubuğu ve dinamik analiz

- Görünen Yapılar Hassasiyeti Ayar Çubuğu (Structure Detection Sensitivity Slider) eklendi: Birleşik Analiz panelinde %0-%100 hassasiyet ayarı ile renk/sinyal toleransı (`match_threshold`), min piksel alanı (`min_area`) ve min güven skoru (`min_confidence`) canlı olarak dinamik ayarlanabilir.
- Debounced (150ms) slider event handler'ı entegre edildi; slider sürüklendiğinde ekrandaki 2D harita ve 3D anomali tespitleri canlı olarak güncellenir.
- Rust `AnalyzeImageRequest` DTO'su ve `analyze_uploaded_image` komutu dinamik `sensitivity` parametrelerini alacak şekilde güncellendi.
- VOTEX 0.4.117 Windows setup üretildi.

## 0.4.116 — 23 Eylül 2026

### Canlı saha akışı, otomatik saha raporu ve kontrol listesi

- Bluetooth (BLE) cihaz bağlantı modülü eklendi: tarama, bağlanma, canlı veri akışı ve "⏹ Bitir ve Kaydet" ile tek dokunuşta Case Package + arşiv kaydı; bağlantı kopmasında otomatik arşivleme.
- Canlı 2D ısı haritası eklendi: tarama sürerken harita, yürüyüş izi ve ziyaret edilmemiş kare uyarısı (6×3 "kenar boş kaldı" tespiti).
- Cihaz görünümü: gökkuşağı paleti ve eşik üstü net kontur ile cihazın kendi programının görünümüne uyarlama; karşılaştırma için "Votex" görünümü seçilebilir.
- Otomatik tek sayfalık saha raporu: kapsama yüzdesi, atlanan kareler, hedef listesi ve seçilen hedeflerin 3D sahne görüntüsü eki; yazdırma/PDF ve HTML kayıt.
- Saha raporu arşive `field_report.html` olarak SHA-256 bütünlük metadata'sıyla iliştirilir; arşivden "📄 Rapor" ile yeniden görüntülenir, kurcalanma/silme bütünlükte raporlanır.
- Saha kontrol listesi modu: ✓/⚠/✗ denetim maddeleri, hüküm rozeti (TARAMA TAM / KONTROL GEREKLİ / TARAMA EKSİK) ve kapsama + yürüyüş izi SVG diyagramı.
- Birleşik objelerin operatör doğrulama durumuna göre renklenmesi (yeşil/kırmızı/turuncu) ve seçili obje için renkli 3D bilgi rozeti eklendi.
- VOTEX 0.4.116 Windows setup üretildi.

## 0.4.115 — 22 Eylül 2026

### 3D Kesit Bıçağı, Dipol Güven Motoru, Çoklu Çekim ve Saha İhracı

- Canlı 3D kesit bıçağı (clipping plane) ile anomali ve katman kesit analizi eklendi.
- Dipol manyetik karakteri ve anomali simetrisi üzerinden olasılıksal güven oranı (%) sınıflandırması geliştirildi.
- Çoklu çekim tarama birleştirici (multi-grid scan stitcher) desteği sağlandı.
- Yapılandırılmış saha ekspertiz raporu ve AR/GeoJSON export araçları entegre edildi.
- VOTEX 0.4.115 Windows setup üretildi.

## 0.4.114 — 21 Eylül 2026

### Arşiv bütünlüğü ve Case Package round-trip

- Legacy arşivlerinde `source.json`, `legacy_result.json` ve `case_package.json` için SHA-256 bütünlük metadata’sı eklendi.
- Arşiv açılışında doğrulandı, uyuşmazlık, eksik, doğrulanmadı ve eski format durumları ayrıştırılır.
- Case Package restore akışı arşiv ve taşınabilir JSON import’unda ortaklaştırıldı; doğrulanmış derived field model doğrudan korunur.
- Tauri arşiv round-trip ve kurcalanmış içerik regresyon testi eklendi.
- VOTEX 0.4.114 Windows setup üretildi.

## 0.4.113 — 21 Eylül 2026

### Öğrenme ve kalibrasyon tutarlılığı

- Öğrenilmiş tip bazlı derinlik bantlarının doğrulanmış tespit türüyle üretilmesi düzeltildi.
- 3D model, panel ve arşiv açılışında öğrenilmiş eşiklerin aynı şekilde kullanılması sağlandı.
- Kalibrasyon snapshot’ındaki gözlenen derinlik ve ölçek değerleri yeniden yüklemede korunur.
- VOTEX 0.4.113 Windows setup üretildi.

## 0.4.112 — 21 Eylül 2026

### Yerel öğrenilmiş eşik kalibrasyonu

- Sahada doğrulanan ve elenen hedef kararlarından tip, derinlik ve σ eşikleri için sınırlı yerel öğrenme katmanı eklendi.
- Az örnekle eşiklerin değişmesi engellendi; güven ve σ değerleri güvenli sınırlar içinde, derinlik bantları ise yumuşak geçişle güncellenir.
- Öğrenilmiş eşikler JSON/arşiv açılışında geri yüklenir ve hedef durum etiketlerinde kullanılır.
- Hedef kartlarına saha doğrulama/eleme kararları eklendi; kararlar fingerprint tabanlı oturumda saklanır.
- Öğrenilmiş eşikler uygulama ayarlarında kalıcı tutulur.
- VOTEX 0.4.112 Windows setup üretildi.

## 0.4.111 — 20 Eylül 2026

### Lateral yanıt adayları ve saha kalibrasyonu kalıcılığı

- Komşu tarama adımlarındaki olası aynı kaynak / lateral yanıt ilişkileri ayrı bir proxy skoru ile hesaplanır; mevcut birleşme kararını ve ölçülen footprint boyutlarını değiştirmez.
- 1 m referans kazığı okumalarına göre lateral skorlar sınırlı (0,75×–1,33×) ve medyan tabanlı otomatik ayarlanır.
- Lateral adaylar 3D'de Kanıt görünümünde kesikli mavi açıklayıcı çizgi olarak gösterilir; fiziksel bağlantı değildir.
- Kalibrasyon snapshot'ı (okumalar, önce/sonra, derinlik ölçeği, kalite) fingerprint anahtarlı saha oturumuna kaydedilir ve aynı JSON yeniden açıldığında otomatik geri yüklenir.
- Arayüzde "✓ Kalibrasyon geri yüklendi" rozeti; üst runtime durumunda kalibrasyon geri yükleme bilgisi gösterilir.
- Gerçek JSON fixture ile fingerprint oturumu + kalibrasyon geri yükleme smoke testi eklendi.
- VOTEX 0.4.111 Windows setup üretildi.

## 0.4.110 — 20 Eylül 2026

### Birleşik hedef sade görünüm ve ortak seçim akışı

- Seçili birleşik hedef için Sade, Kanıt ve Tam görünüm seçenekleri eklendi.
- Sade görünüm yalnızca seçili birleşik hedef ile yatay bağlantılarını gösterir.
- Kanıt görünümü hedefi oluşturan ham anomalileri de gösterir.
- Tam görünüm tüm saha katmanını gösterir.
- Panel, 3D overlay ve kamera seçimleri ortak case-store sözleşmesini kullanır.
- Üst durum satırında çalışan sürüm, adım yönü, görünüm, profil ve seçim gösterilir.

## 0.4.109 — 20 Eylül 2026

### Varsayılan adım numaralandırma yönü

- Legacy tarama adımlarının varsayılan numaralandırması artık sağdan sola başlar.
- 3D grid, sol panel ve JSON yeniden analiz akışı aynı RTL varsayılanını kullanır.
- Soldan sağa seçeneği korunur ve kullanıcı tarafından ayrıca seçilebilir.
- RTL varsayılanı için regresyon testi eklendi.
- VOTEX 0.4.109 Windows setup üretildi.

## 0.4.108 — 20 Eylül 2026

### Birleşik hedef güven trend grafiği

- Birleşik hedef seçildiğinde kaynak adımların güven yüzdeleri SVG trend grafiğinde gösterilir.
- İlk ve son adım arasındaki güven değişimi puan olarak görünür.
- Grafik, mevcut adım-güven-derinlik zaman çizelgesini tamamlar; ölçüm veya birleşme hesabını değiştirmez.
- Zaman çizelgesi grafik hesaplaması için regresyon testleri eklendi.

## 0.4.107 — 19 Eylül 2026

### JSON replay sözleşmesi ve runtime sürüm guard’ı

- Rust `LegacyDikResult` ile JS saha modelini aynı canonical fixture üzerinden doğrulayan replay sözleşmesi eklendi.
- Çalışan runtime sürümü uygulama başlığı ve sürüm rozetine yazılır; UI sözleşmesi de görünür hale getirildi.
- Anomali analiz yüzdeleri ve kaynak dayanakları korunur.

## 0.4.106 — 19 Eylül 2026

### Açıklanabilir anomali yüzdeleri

- Anomali analiz panelinde her yüzde için kaynak alan ve ham değer gösterilir.
- Sinyal, güven, kompaktlık ve tekrarlanabilirlik metrikleri canonical analiz DTO’sundan beslenir.
- Tekrarlı ölçüm yoksa tekrarlanabilirlik zorla üretilmez; eksik veri nedeni gösterilir.
- Yeni JSON akışı ve üretim build’i doğrulandı.
- VOTEX 0.4.106 Windows setup üretildi.

---

## 0.4.105 — 19 Eylül 2026

### Sağ dock analiz penceresi

- Anomali analiz penceresi artık ekranı karartmayan sağ dock panel olarak açılır.
- Ana 3D sahne, sol menü ve sağ rapor etkileşimleri kilitlenmez.
- Panel yalnızca seçilen anomalinin yanında görünür; adım/temizleme seçimlerinde kapanır.
- VOTEX 0.4.105 Windows setup üretildi.

---

## 0.4.104 — 19 Eylül 2026

### Anomali sinyal analiz penceresi

- Anomali seçildiğinde ayrı analiz penceresinde sinyal gücü, güven, kompaktlık ve tekrarlanabilirlik yüzdeleri gösterilir.
- Yüzdelerin dayanakları (adım, derinlik, merkez, boyut, sinyal σ, profil ve tekrar ölçümleri) görünür hale getirildi.
- Yorumların malzeme kimliği veya değerli metal kesinliği olmadığı açıkça belirtilir.
- VOTEX 0.4.104 Windows setup üretildi.

---

## 0.4.103 — 18 Eylül 2026

### Canonical birleşik geometri ve saha kararı kalıcılığı

- Birleşik hedefler canonical footprint ve connector geometri çıktısı taşır.
- 3D renderer connector/boşluk kararını tekrar hesaplamaz.
- Connector koridorları ölçülen kanıtlardan ayrı görsel katman olarak gösterilir.
- Eski büyük kutu birleşik layer builder'ı kaldırıldı; tek unified 3D layer kullanılır.
- Ayırma kararları ve birleşme politikası fingerprint'li saha oturumunda korunur.
- Zincirleme hedeflerde maksimum yatay boşluk bilgisi açıklanabilir hale getirildi.
- VOTEX 0.4.103 Windows setup üretildi.

---

## 0.4.102 — 18 Eylül 2026

### Birleşik hedef inceleme çalışma alanı

- Birleşik hedef kartı artık seçilen fiziksel hedefi tek çalışma alanında gösterir.
- Birleşik derinlik, kaynak kanıt sayısı, yatay bağlantı sayısı ve birleşme güveni ayrı metrikler olarak görünür.
- Birleşme nedenleri ve kaynak adımlar listelenir; kanıt düğmesine tıklayınca ilgili 3D bulguya odaklanılır.
- Birleşik hedef ile ham kanıt görünümü arasında geçiş korunur.
- VOTEX 0.4.102 Windows setup üretildi.

---

## 0.4.101 — 18 Eylül 2026

### Seçim/görünürlük geçiş sözleşmesi ve birleşik 3D hedefler

- Birleşme politikası, kanıt kalitesi, yatay bağlantılar ve birleşme nedenleri canonical modelde tek çıktı olarak toplandı.
- Birleşik 3D katmanı aynı canonical bağlantıları kullanır; küçük yatay boşluklarda koridor, büyük boşluklarda gerçek boşluk korunur.
- Kanıt ayak izleri kaynak kimliği/adım metadata’sıyla korunur; kırmızı metal bulgularının ölçülen boyutu genişletilmez.
- Birleşik hedef ve bağlantı regresyon testleri eklendi.
- Legacy seçim ve harita katmanı görünürlük bayrakları tek sözleşmede birleştirildi.
- Birleşik obje görünürlüğü ile eski yeraltı dilimi görünürlüğünün karışması düzeltildi.
- VOTEX 0.4.101 Windows setup üretildi.

---

## 0.4.99 — 17 Eylül 2026

### Legacy panel controller ayrıştırması

- JSON, analiz, kalibrasyon, görünüm, rapor ve AI event akışları controller katmanlarına ayrıldı.
- Legacy saha görünümü, içerik tabanlı vaka oturumu ve hedef/workflow state yapısı korunarak panel koordinatör hale getirildi.
- Yeni sürüm için JavaScript testleri ve production build doğrulandı.

---

## 0.4.98 — 17 Eylül 2026

### DTA kullanıcı verisi ve kurulum güvenliği

- DTA config, memory, logs, reports ve recordings verileri artık Program Files yerine `%APPDATA%\\DFT\\DerinTaramaAsistan` altında tutulur.
- Kurulumun Program Files klasörlerine standart kullanıcı yazma izni verme ihtiyacı kaldırıldı.
- İlk çalıştırmada eski paket içindeki kullanıcı verileri yeni kullanıcı veri dizinine taşınır.
- DTA launcher ve yardımcı süreçler kullanıcı veri dizinini ortam değişkeniyle ortak kullanır.
- VOTEX 0.4.98 Windows setup üretildi.

---

## 0.4.97 — 16 Eylül 2026

### Kurulum ayrıcalık modeli düzeltmesi

- Kurulum hedefi `{localappdata}\Programs` yerine `{autopf}` (makine-başı Program Files) olarak değiştirildi; yönetici modunda kurulan uygulama artık tüm kullanıcıların görebileceği ortak konuma kurulur.
- `UsePreviousAppDir=no` eklendi: eski per-user kurulumun kayıtlı hedefi yeni kurulumu eski konuma çekemez.
- DTA çalışma klasörlerine (config, logs, memory) `users-modify` izni verildi; standart kullanıcı altında Python config/log yazımı çalışır.
- VOTEX ayarlarındaki `dtaLaunchPath` artık yeni makine-başı DTA konumunu gösterir.
- Eski per-user kurulumlar `{localappdata}\Programs` altından sessizce kaldırılmaya devam eder; kaldırıcı başarısız olsa bile kurulum durmaz.
- VOTEX 0.4.97 Windows setup üretildi.

---

## 0.4.96 — 16 Eylül 2026

### Tek VOTEX kurulum yolu

- Nested Tauri NSIS kurulumu kaldırıldı; VOTEX artık birleşik setup içinde yalnızca doğrudan staging dosyalarından kurulur.
- Eski kaldırıcı çalışmazsa kurulum devam eder; kurulum metadata’sına SHA-256 ve paketleme modu eklenir.
- VOTEX 0.4.96 Windows setup üretildi.

---

## 0.4.95 — 16 Eylül 2026

### Kurulum dayanıklılığı

- Eski VOTEX/DFT Suite kaldırıcıları eksik veya kilitli olsa bile yeni setup kurulumu artık durmaz; uyarıyla devam eder.
- VOTEX 0.4.95 Windows setup üretildi.

---

## 0.4.94 — 16 Eylül 2026

### Saha görev akışı ve hedef çalışma alanı

- Legacy paneline `JSON → Adım → Hedef → 3D doğrula → Not / rapor` sıralı saha görev akışı eklendi.
- Sıradaki işlem tek düğmeyle başlatılır; tamamlanan adımlar görünür şekilde işaretlenir.
- Hedef kartı not/fotoğraf ve rapora ekleme işlemleriyle birleştirildi.
- Saha raporuna eklenen hedefler derinlik, güven, not ve fotoğraf bilgileriyle ayrı bölümde gösterilir.
- Üretim doğrulaması: 394 JavaScript testi geçti.
- VOTEX 0.4.94 Windows setup üretildi.

---

## 0.4.93 — 16 Eylül 2026

### Basit kullanım ve hedef odaklı saha akışı

- Legacy3DMAG paneline Basit kullanım / Uzman ayarları görünümü eklendi.
- Seçili adım veya obje için hedef kartı; derinlik aralığı, proxy orta değer, güven ve güç bilgilerini gösterir.
- Hedef modu, yalnız seçili hedefi gösterme ve önceki/sonraki hedef navigasyonu eklendi.
- Normal, Derin hedef ve Saha kazığı hazır parametre profilleri eklendi.
- Saha kalibrasyonunda önce/sonra karşılaştırması hedef kartına taşındı.
- VOTEX 0.4.93 Windows setup üretildi.

---

## 0.4.92 — 16 Eylül 2026

### Saha kazığı tekrar okumaları

- 1 m referans kazığı saha kalibrasyonunda en fazla 3 tekrar okuması kaydedilebilir.
- Okumaların ortalaması ve 1,00 m referansa göre önceki hata gösterilir.
- Parametre uygulandıktan sonra yeni okuma ile sonraki hata karşılaştırılır.
- VOTEX 0.4.92 Windows setup üretildi.

---

## 0.4.91 — 16 Eylül 2026

### İki kalibrasyon modu

- Mevcut tek obje / bilinen derinlik kalibrasyonu korunarak devam eder.
- İsteğe bağlı saha cihaz kalibrasyonu eklendi: 1 m referans kazığı cihazın derinlik ölçeği için mihenk noktası olarak kullanılabilir.
- Saha modunda hedef derinlik otomatik olarak 1,00 m olur ve tek obje derinliği mod değişiminde korunur.
- VOTEX 0.4.91 Windows setup üretildi.

---

## 0.4.90 — 16 Eylül 2026

### Cihaz–yüzey mesafesi kalibrasyonu düzeltmesi

- Legacy parametrelerinde varsayılan cihaz–yüzey mesafesi **0,10 m** olarak güncellendi.
- Mutlak üst sınır **0,20 m** yapıldı; eski 0,50 m kayıtları güvenli aralığa kısılır.
- Yerel ve AI kalibrasyon önerileri aynı 0–0,20 m sınırını kullanır.
- Rust analiz motoru artık mesafe değerini sabit 0,50 m yerine doğrulanmış parametreden alır.
- VOTEX 0.4.90 Windows NSIS setup üretildi.

---

## 0.4.89 — 15 Eylül 2026

### Adım ızgarası haritaya tam oturur

- Matris hücreleri artık kareye sıkıştırılmaz; `width/cols × depth/rows` ile harita kenarına kadar uzanır.
- 9×3 / 3×6 m gibi dikdörtgen sahalarda yandaki boş şerit kalkar.
- VOTEX 0.4.89 Windows NSIS setup üretildi.

---

## 0.4.88 — 15 Eylül 2026

### Adım numaralandırma LTR / RTL

- Soldan sağa / sağdan sola seçimi artık aynı fiziksel noktada görünen adım numarasını değiştirir.
- 3D hücre etiketleri ve sol panel listesi birlikte güncellenir (matris satır×sütun gerekli).
- VOTEX 0.4.88 Windows NSIS setup üretildi.

---

## 0.4.87 — 15 Eylül 2026

### Sol menü tespit tıklanınca boş 3D ekran

- Tespit seçiminde `legacyRealisticLayer` ve diğer detectionId’siz katman kökleri artık gizlenmez.
- Odak yolu `selectedStructureId` + seçim rehberi + ebeveyn zincirini açar.
- Legacy JSON yüklenince JPG placeholder kapanır.
- VOTEX 0.4.87 Windows NSIS setup üretildi.

---

## 0.4.86 — 15 Eylül 2026

### Legacy JSON görüntüleme onarımı

- Bozuk Saha görünümü yaması kaldırıldı; `legacyDikOverlay.js` tekrar parse edilir.
- **Birleşik 3D / Saha planı / Sadece objeler** gerçek katman ayrımı yapar (her şeyi gizlemez).
- Tomografi / yüzey altı / jeotermal / derinlik haritası tespit seçiminde kapanmaz.
- Saha görünümü HTML satırı düzeltildi; panel `applyFocusSafeStepVisibility` importu eklendi.
- Kontür↔sinyal karışım opaklığı okunur hale getirildi; uzak invert proxy zorla bağlanmaz.
- VOTEX 0.4.86 Windows NSIS setup üretildi.

---

## 0.4.85 — 14 Eylül 2026

### Sol menü seçiminde boş 3D ekran düzeltmesi

- Sol menüden obje seçildiğinde seçilen objenin alt gövde/container parçaları artık gizlenmez.
- Basit/Saha görünüm profilleri seçili objenin gövdesini, etiketi ve yardımcı parçalarını kapatamaz.
- Seçili objenin kimliği ebeveyn grupta bulunduğunda da doğru şekilde çözülür.
- İlgili seçim regresyonları doğrulandı.

---

## 0.4.84 — 14 Eylül 2026

### Etiket görünürlüğü ve adım numaralandırma yönü

- 3D etiket seçeneği açıkça **Göster · rozet**, **Göster · tam kart** ve **Etiketleri kaldır** olarak ayrıldı.
- Adım numaralandırması için **Soldan sağa** ve **Sağdan sola** seçenekleri eklendi.
- Yön değiştiğinde mevcut JSON yeniden analiz edilerek panel, hücre, adım ve obje eşleştirmesi birlikte güncellenir.
- VOTEX 0.4.84 Windows setup üretildi.

---


### Sol menü adım ve obje seçim düzeltmesi

- Sol menüdeki adım kartları artık ortak seçim ve kamera odaklama akışını doğru çalıştırır.
- Obje kartları, “3D’de göster” ve “Sadece bunu göster” eylemleri ilgili adım filtresini uygular.
- Liste filtrelerinde tıklama hatası giderildi.

---

## 0.4.82 — 14 Eylül 2026

### Ortak adım–obje–kamera seçimi

- Adım, obje kartı, rapor kartı ve 3D tıklaması ortak Legacy seçim/odaklama akışına bağlandı.
- Seçili adım dışında kalan Legacy görsel katmanları ve yardımcı objeler gizlenir.
- Tümü seçimi adım, obje ve kamera seçim durumunu birlikte sıfırlar.

---

## 0.4.81 — 14 Eylül 2026

### Adım filtresi ve temiz 3D kurulum

- Seçili adım görünürlük düzeltmeleriyle birlikte yeni Windows kurulum paketi üretildi.
- Tauri ve birleşik DFT Suite paketleri aynı sürüm metadata’sını kullanır.

---

## 0.4.80 — 14 Eylül 2026

### Adım numarasıyla doğrudan odaklama

- Adım numarası girilip Git seçildiğinde kamera doğrudan ilgili hücreye gider.
- Yalnız seçilen adıma bağlı kare, işaretler ve 3D objeler görünür.
- Tümü seçeneğiyle saha görünümü geri alınabilir.

---

Tüm sürümlerin değişiklik kaydı.

## 0.4.79 — 14 Eylül 2026

### Adım seçimi görünürlüğü

- Adım seçildiğinde yalnız seçilen hücre, tarama işareti ve o hücreye bağlı objeler görünür.
- Tümü seçildiğinde tüm hücreler ve objeler geri gelir.

## 0.4.78 — 14 Eylül 2026

### Saha görünüm modları

- Legacy3DMAG için Birleşik 3D, Saha planı ve Sadece objeler görünümleri eklendi.
- Saha planında adım kareleri ve numaraları korunurken derinlik objeleri gizlenebilir.
- Görünüm değiştiğinde seçili adım ve filtre durumu korunur.

---

## 0.4.77 — 13 Eylül 2026

### Adım–obje koordinat hizalaması

- 6×3 şablonunda hücreler gerçek fiziksel tarama adımlarının merkezlerine bağlandı.
- Obje konumu ile adım etiketi aynı `cx/cy` koordinat sözleşmesini kullanıyor.
- JSON’daki 3 fiziksel geçiş, manuel 18 hücreye global bölünmek yerine her geçiş içinde 6 hücreye ayrılıyor.
- Tespit seçimi ve 3D hücre görünürlüğü hizalı hale getirildi.
- VOTEX 0.4.77 Windows setup üretildi.

---



### Kare tabanlı tarama şablonu

- `6×3` girişi artık 6 satır × 3 sütun olarak gerçek kare hücre şablonuna dönüştürülür.
- 3D sahnede her ölçüm adımı kare hücre, numara ve gidiş/dönüş yönüyle gösterilir.
- Kare şablonu ile cihazın fiziksel tarama yolu birbirinden ayrılır; adım seçimi hücre bazında çalışır.
- 38 test dosyası ve 373 JavaScript testi doğrulandı.
- VOTEX 0.4.76 Windows setup üretildi.

---



### Adım bazlı obje görünümü

- Taramadaki adım kartına tıklanınca yalnız o adımda çıkan 3D objeler, sinyal katmanları ve bağlantı kılavuzları gösterilir.
- **Tümü** düğmesiyle tüm objeler yeniden görünür.
- Başlangıçta tüm objeler görünür; seçili adım durumu panel, 3D ve tespit eşlemesinde ortak kullanılır.
- VOTEX 0.4.75 Windows setup üretildi.

---

## 0.4.74 — 13 Eylül 2026

### Cihaz–yüzey sınırı 50 cm

- Legacy JSON Parametrelerinde cihaz–yüzey sınırı sabit **0,50 m (50 cm)** yapıldı.
- Cihaz–yüzey alanı kullanıcı tarafından değiştirilemez; hedef derinlik bipolar çarpan ve dipol karışımıyla ayarlanır.
- Derinlik kalibrasyon önerileri sabit 0,50 m değerini korur.
- VOTEX 0.4.74 Windows setup üretildi.

---

## 0.4.73 — 13 Eylül 2026

### Fiziksel gidiş-dönüş tarama sırası

- Adım numaraları artık koordinata göre yeniden sıralanmaz; JSON/cihazın gerçek kaynak sırası korunur.
- Soldan tutulan cihazın gidiş-dönüş hareketi ve hatlar arasındaki bir adım kayması panel, 3D ve raporda aynı görünür.
- Rust analiz hattı ile JavaScript normalizasyon hattı aynı fiziksel sıra sözleşmesini kullanır.
- 6'lı gidiş-dönüş ve kaydırılmış hatlar için regresyon testleri eklendi.
- VOTEX 0.4.73 Windows setup üretildi.

---

## 0.4.72 — 13 Eylül 2026

### Görsel adım sıralaması ve yeni Windows setup

- Legacy3DMAG adımları artık sol-alt noktadan başlayıp satır içinde soldan sağa, satır bitince üst satıra geçecek şekilde numaralandırılır.
- Serpantin/ters numaralandırma kaldırıldı; panel, 3D cetvel, rapor ve tespit eşleştirmesi aynı görsel sıra sözleşmesini kullanır.
- VOTEX 0.4.72 Windows setup üretildi.

---


### JSON 3D geometri ayrımı ve kurulum paketi

- Normalize edilmiş JSON sonuçları tekrar işlendiğinde tarama adımları tersine dönmez.
- 3D görsel kaynakları ölçülmüş kontur, tahmini şekil ve yalnız manyetik sinyal olarak ayrıştırılır.
- Obje etiketlerinde geometri kaynağı açıkça gösterilir.
- VOTEX 0.4.71 Windows NSIS setup üretildi.

---


### Kalibrasyon · Saha özeti · Karşılaştır · Tutarlılık · Multi-invert · Rehber

- **Kalibrasyon defteri**: Parametre çekmecesinde saha etiketi + derinlik çarpanlarını kaydet / yükle / sil.
- **Saha özeti**: Yazdırılabilir HTML (PDF) — seçili bulgu, lejant, Parametre; CSV/GeoJSON yanına.
- **Karşılaştır** kaydırıcısı: kontür ↔ sinyal karışımı; Invert açıksa ortada proxy vurgusu.
- **Çoklu çekim tutarlılık**: aynı saha adına göre arşiv Δz rozeti (tutarlı / orta / dağınık).
- **Invert proxy** tüm metallere (en fazla 5 örtüşmeyen blob).
- **İlk 5 dk rehberi**: dik çekim kutusunda kapatılabilir kontrol listesi.
- VOTEX 0.4.70 Windows NSIS setup üretildi.

---

## 0.4.69 — 13 Eylül 2026

### Matris uyarı · Invert seçim · Tomografi peaking · Export

- Tarama matrisi etiketi vs analiz adım sayısı uyumsuzsa kırmızı uyarı.
- Invert proxy seçili tespitte görünür; z belirsizlik bandı (misfit) eklendi.
- Tomografi peaking sıkılaştırıldı; odak tespitte dilimler yeniden boyanır.
- Tespitler **CSV** / **GeoJSON** dışa aktarım (plan metre + Parametre özeti).
- VOTEX 0.4.69 Windows NSIS setup üretildi.

---

## 0.4.68 — 12 Eylül 2026

### Tarama matrisi giriş kutuları

- Satır × sütun kutuları genişletildi; rakam rahat girilir.
- VOTEX 0.4.68 Windows NSIS setup üretildi.

---

## 0.4.67 — 12 Eylül 2026

### 3D tıklama düzeltmesi + AI → Parametre

- Yüzey tıklaması y=0 düzlemine sabitlendi; duvar/taban hit’ine aldanmadan en yakın bulguya kamera odaklanır.
- **AI öner** sonucu Parametre alanlarına otomatik yazılır (kaydetmek için Uygula).
- VOTEX 0.4.67 Windows NSIS setup üretildi.

---

## 0.4.66 — 12 Eylül 2026

### 3D yüzey tıklama → kamera odak

- Manyetik harita / yüzeydeki bulguya tıklanınca en yakın Legacy tespit seçilir ve kamera oraya uçar.
- Liste kartı kaydırılır; saha özeti / seçim senkronu korunur.
- VOTEX 0.4.66 Windows NSIS setup üretildi.

---

## 0.4.65 — 12 Eylül 2026

### Invert proxy + dürüst şekil dili + AI kalibrasyon

- Kompakt manyetik **Invert proxy** (dipol uydurma ayak izi): ölçülen kontürü değiştirmez; CAD / gerçek şekil iddiası yok.
- 3D çizim etiketleri: **Anomali kontürü** / aday dil; “Net şekil / Tünel / Oda” yanıltıcı etiketleri kaldırıldı.
- Parametre çekmecesinde **saha etiketi + AI öner / Öneriyi yaz** (AI yoksa yerel öneri).
- VOTEX 0.4.65 Windows NSIS setup üretildi.

---

## 0.4.64 — 12 Eylül 2026

### Parametre çekmecesi (derinlik çarpanları)

- Legacy JSON panelinde **Parametre** katlanır ayar: cihaz–yüzey (m), bipolar çarpan, dipol karışım (%).
- Değerler `%APPDATA%\Votex\settings.json` içinde kalıcı; Uygula kaydeder ve yüklü JSON’u yeniden analiz eder.
- Varsayılanlar: 0,40 m / 1,85 / %30 dipol (önceki sabitlerle aynı).
- VOTEX 0.4.64 Windows NSIS setup üretildi.

---

## 0.4.63 — 12 Eylül 2026

### Ters adım numarası + cihaz–yüzey 40 cm

- Adım indeksleri serpantin yolun **tersinden** yazılır (eski son konum = Adım 1).
- Derinlik tahminlerine cihaz–yüzey boşluğu **+0,40 m** eklenir (metal + heuristic).
- VOTEX 0.4.63 Windows NSIS setup üretildi.

---

## 0.4.62 — 12 Eylül 2026

### Serpantin adım dizilişi + derinlik yumuşatma

- Matris numaralandırma artık **serpantin**: çift sütun Y↑, tek sütun Y↓ (cihaz yürüyüşü).
- 3D adım yolu sütun içi bağlanır; sütunlar arası uzun atlama çizgisi kesilir.
- Bipolar derinlik: `z ≈ 1.85·Δ`, dipolle %30/%70 karışım (~2,5 m; önceki ~3,1 m abartısı azaltıldı).
- VOTEX 0.4.62 Windows NSIS setup üretildi.

---

## 0.4.61 — 12 Eylül 2026

### 3D adım etiketleri daha ince/küçük

- “Adım N” yazıları ince (400) ve daha küçük punto; sahne kalabalığı azaldı.
- VOTEX 0.4.61 Windows NSIS setup üretildi.

---

## 0.4.60 — 11 Eylül 2026

### Bipolar metal derinliği (tepe–çukur)

- Yalnızca pozitif lobdaki dipol fit ~1,5 m’ye sığ kalabiliyordu; net negatif çukur varken **bipolar proxy** (z ≈ 2·Δ) kullanılır.
- Bakır tava örneği: merkez ~3,1 m, örtü ~2,2–3,9 m (saha etiketi 3,3–3,5 m bandı).
- Matris girişi derinliği hâlâ değiştirmez (0.4.59 davranışı korunur).
- VOTEX 0.4.60 Windows NSIS setup üretildi.

---

## 0.4.59 — 11 Eylül 2026

### Matris girişi derinliği bozmaz

- JSON’da fiziksel `segment_ranges` varken **satır×sütun matrisi yalnızca adım etiketleri** üretir; median leveling geçişleri ezilmez.
- Böylece (ör. bakır tava 6×3) matris girince derinlik ~1,5 m’ye çökmez; JSON geçişleriyle aynı proxy derinlik kalır.
- Segmenti olmayan dosyalarda eski davranış korunur (adım sayısı leveling’i de bölebilir).
- VOTEX 0.4.59 Windows NSIS setup üretildi.

---

## 0.4.58 — 11 Eylül 2026

### Tarama matrisi girişi (satır × sütun)

- “Adım sayısı” yerine **Satır × Sütun** girilir (ör. 6×3 = 18 adım).
- Toplam adım = satır×sütun; numaralandırma matris sırasıyla (sol→sağ sütun, alttan üste).
- İkisi 0 ise otomatik (JSON segment / adım ölçüsü) devam eder.
- VOTEX 0.4.58 Windows NSIS setup üretildi.

---

## 0.4.57 — 11 Eylül 2026

### Tarama adımları matris sırası

- Cihaz ızgarası (ör. **6×3 = 18 adım**) matris gibi numaralanır: sol sütundan sağa, her sütunda alttan üste.
- X/Y kümeleri otomatik bulunur; net ızgara yoksa önceki kararlı yedek sıra kullanılır.
- Panel, 3D cetvel ve tespit–adım eşlemesi aynı matris numarasını paylaşır.
- VOTEX 0.4.57 Windows NSIS setup üretildi.

---

## 0.4.56 — 11 Eylül 2026

### Panel adımı = 3D adım (serpentine düzeltmesi)

- `orderScanStepsLeftFirst` ekseni artık X/Y **açıklığına** göre seçer (ardışık dx/dy değil) → idempotent.
- `legacyStepsOf` ikinci kez sıralamazdı; panel “Adım 19” / 3D “Adım 13–14” kayması giderildi.
- En yakın adım: segment mesafesi (uzun geçişlerde doğru hat).
- Adım etiketleri halkanın üstünde (yan offset yok).
- VOTEX 0.4.56 Windows NSIS setup üretildi.

---

## 0.4.55 — 11 Eylül 2026

### 3D obje–adım hizası

- Ölçüm poligonu artık tespit tepesine (`cx/cy`) ankrajlanır; adım eşlemesi ile aynı nokta.
- Ölçülmüş kontura `orientationDeg` tekrar uygulanmaz (çift döndürme kaymasını giderir).
- Adım merkezi ile tepe arasında yüzey bağlantı çizgisi (uzaksa).
- Adım etiketleri işaretçiye daha yakın.
- VOTEX 0.4.55 Windows NSIS setup üretildi.

---

## 0.4.54 — 11 Eylül 2026

### 3D adımlar + etiket / menü okunabilirliği

- 3D çizimde tarama adımları (yol, halka, “Adım N”) tespit seçiliyken de görünür kalır.
- Nesne etiketlerinde kenar boşluğu sıkılaştırıldı; yazı punto aynı.
- Sol menü Legacy yazı boyutları eşitlendi (küçük punto override’ları kaldırıldı).
- VOTEX 0.4.54 Windows NSIS setup üretildi.

---

## 0.4.53 — 11 Eylül 2026

### Tarama Adımları Soldan

- `scan_steps` leveling sonrası **küçük X → büyük X** sıralanır; Adım 1 solda.
- Leveling segment sırası (manyetik referans) değişmez; blob/metal konumu aynı.
- Eski arşiv RTL sonuçları JS normalize ile de sol-önce yeniden numaralanır.
- VOTEX 0.4.53 Windows NSIS setup üretildi.

---

## 0.4.52 — 11 Eylül 2026

### Bilimsel etiket düzeltmesi

- Manyetik tepki: “Ferromanyetik” iddiası kaldırıldı → **güçlü pozitif (metal-benzeri)** / **negatif (boşluk-benzeri)**.
- Lejant ölçeği: ham residual vs `magSigma` ile gerçek σ ayrımı; kalibre nT yok.
- VOTEX 0.4.52 Windows NSIS setup üretildi.

---

## 0.4.51 — 11 Eylül 2026

### Lejant · Sayısal Güven · Manyetik Tepki

- Ana ekran lejantı: tür renkleri + **+σ / −σ** kutup satırı; not: `residual σ · kalibre nT değil`; grid max |residual| ölçeği.
- 3D kart / saha özeti: `güven orta (%72) · 3.4σ` (peakSigma = SNR proxy).
- Manyetik tepki yorumu (metal-benzeri / boşluk-benzeri) + **χ ölçülmedi · malzeme kimliği değil**.
- Analiz / Rust sözleşmesi değişmez.
- VOTEX 0.4.51 Windows NSIS setup üretildi.

---

## 0.4.50 — 11 Eylül 2026

### Kesit ↔ Obje Senkronu · Saha Özeti · Güven Kabuğu

- **Tomografi dilimi** açıkken dilim bandındaki objeler parlak, dışı soluk (X-Ray’de opaklık `_origMat` üzerinden; ortak shader sızdırmaz); seçili bulgu okunur kalır.
- Tespit seçince **SAHA ÖZETİ** kartı: derinlik, konum, boyut, güven + metni kopyala.
- Tahmini gövdede düşük güven → daha geniş **belirsizlik kabuğu** (yalnız görsel).
- Analiz / tespit sonucu değişmez.
- VOTEX 0.4.50 Windows NSIS setup üretildi.

---

## 0.4.49 — 11 Eylül 2026

### Tahmini Gövde (Her Bulgu)

- Her tespitte okunabilir **tahmini gövde**: ölçüm poligonu ≥3 ise o kontür; değilse `shapeType` şablonu (daire/elips/dikdörtgen/kapsül).
- Yüzeyde ayak izi halkası; düşük güven → daha şeffaf / kesikli kenar.
- **Net şekil** bakışında görünür; analiz sonucu değişmez.
- VOTEX 0.4.49 Windows NSIS setup üretildi.

---

## 0.4.48 — 10 Eylül 2026

### Saha Kullanıcısı 3D Çizimleri

- Varsayılan **Net şekil** bakışı: sinyal bulutu kapalı; dolu çekirdek / oda / tünel okunur.
- Panelde **3D çizim**: Net şekil / Sinyal bulutu / İkisi birlikte.
- Tür renkleri (Metal / Anomali / Tünel / Oda) + efsane.
- İlk bulgularda **1 m ölçek çubuğu** ve sade derinlik oku.
- Etiket metni sade dil: “Ne kadar derin / Haritada nerede / Ne kadar net” (RMS/σ yok).
- Seçili bulgu parlak, diğerleri soluk — hesap sonucu değişmez.
- VOTEX 0.4.48 Windows NSIS setup üretildi.

---

## 0.4.47 — 10 Eylül 2026

### Çift 3D Etiket Düzeltmesi

- Metal seçiminde `shape.label` + rank kartı çakışması kaldırıldı; tek kanonik detay kartı.
- Yedek `makeDetailSprite` / çift rozet artık açılmaz.
- VOTEX 0.4.47 Windows NSIS setup üretildi.

---

## 0.4.46 — 10 Eylül 2026

### 3D Etiket Çorbası Düzeltmesi

- Varsayılan **Rozet** modu: küçük `#N` pin’ler; tam kart yalnız seçili tespitte.
- Panelde **3D etiket** seçici: Rozet / Tam kart / Kapalı.
- Adım ve tespit filtresi etiketlere de uygulanır; obje geometrisi kapanmaz.
- Metal seçiminde çift kart (`shape.label` + rank) kaldırıldı; tek kanonik detay kartı.
- VOTEX 0.4.46 Windows NSIS setup üretildi.

---

## 0.4.45 — 10 Eylül 2026

### Tahmini Derinlik Haritası

- LEGACY3DMAG panelinde bağımsız **▤ Derinlik** aç/kapa düğmesi.
- Residual `|σ|` → derinlik proxy planı (güçlü=sığ, zayıf=derin); sığ→derin renk efsanesi.
- Invert / tespit / pick etkilenmez; manyetik grid üstünde bakış katmanı.
- VOTEX 0.4.45 Windows NSIS setup üretildi.

---

## 0.4.44 — 10 Eylül 2026

### Jeotermal AI Yorumu

- Jeotermal açıkken **🤖 AI yorumla** düğmesi: `|σ|` proxy özeti + sıcak odaklar + tespit bağlamı.
- Yerel AI sunucusu (`aiClient` / Ollama) varsa Türkçe yorum; yoksa deterministik yerel özet.
- 3D harita ve tespit mesh’leri değişmez; sonuç panelde metin olarak gösterilir.
- °C olmadığı her yanıtta hatırlatılır.
- VOTEX 0.4.44 Windows NSIS setup üretildi.

---

## 0.4.43 — 10 Eylül 2026

### Jeotermal 3D Proxy Haritası

- LEGACY3DMAG panelinde bağımsız **♨ Jeotermal** aç/kapa düğmesi.
- Residual `|σ|` tabanlı ısı anomalisi skoru + Termal LUT (gerçek °C değil; proxy).
- Çok dilimli yarı saydam hacim; tespit peaking / odak yok; pick tespitlere geçer.
- Tomografi ve yüzey altı haritasından ayrı katman.
- VOTEX 0.4.43 Windows NSIS setup üretildi.

---

## 0.4.42 — 10 Eylül 2026

### Yüzey Altı 3D Renk Haritası

- LEGACY3DMAG panelinde bağımsız **▣ Yüzey altı** aç/kapa düğmesi.
- Residual grid’den çok dilimli yarı saydam renk hacmi; tespit peaking / odak yok.
- Adım veya tespit seçimi haritayı gizlemez; pick ışını tespit mesh’lerine geçer.
- Tomografi inceleme aracı ayrı kalır (slider / play / tespit odağı).
- VOTEX 0.4.42 Windows NSIS setup üretildi.

---

## 0.4.41 — 10 Eylül 2026

### Tomografi İnceleme Aracı

- Tek dilim modu: derinlik slider + metre etiketi, Play/Durdur, opaklık kontrolü.
- Tespit tıklanınca tomografi o hedefin derinlik aralığına odaklanır.
- Renk efsanesi (−σ / 0 / +σ / ölçülmedi), |σ| eşik slider, NormalBlending ile okunabilir katman.
- Dilim başına derinlik peaking: tespit merkezlerinde Gaussian tepe, yüzey residual kopyası değil.
- VOTEX 0.4.41 Windows NSIS setup üretildi.

---

## 0.4.40 — 10 Eylül 2026

### JSON Hattı Sözleşmesi ve Parser Sertleştirme

- Tek JS DTO adaptörü (`normalizeLegacyResult`): eski arşiv `snake_case` yalnız burada çözülür; overlay, tomografi, 3D motor ve panel camelCase okur.
- Şekil birleştirme (`cx:cy` + metal önceliği) tek fonksiyonda toplandı.
- JSON UI `legacyDikPanel.js` modülüne taşındı; arşiv açılışı dosya seçimiyle aynı sol liste / özet / tomografi yolunu kullanır.
- Zero-order median leveling panele bağlandı (Leveling → yeniden analiz).
- Parser imzası substring yerine gerçek parse denemesine bağlandı; analiz komutu geçersiz JSON’u reddeder.
- Belirsiz manyetik/konum kolon çakışmasında açıklayıcı hata.
- Desteklenen biçim matrisi: pandas-split string `scan` · kök `columns`+sayısal `data` · records (`bx`/`pos_x`).
- Altın fixture’lar: `examples/legacy_dik_sample.json`, `legacy_dik_records_fixture.json`, `legacy_dik_root_split_fixture.json`.
- Rust `legacy_mag_json` parse / level / analyze modüllerine bölündü; public API aynı kaldı.
- VOTEX 0.4.40 Windows NSIS setup üretildi.

---

## 0.4.39 — 9 Eylül 2026

### Legacy Obje Etiketlerinde Net Metre Bilgisi

- 3D obje etiketlerinde derinlik aralığı ve merkez derinliği açıkça `m` birimiyle gösterilir.
- Obje plan konumu X/Y değerleri metre olarak etiketlenir.
- Obje genişlik × uzunluk × yükseklik ölçüsü doğrudan etiket üzerinde metre birimiyle gösterilir.
- Etiketler Basit görünümde ve adım filtresi uygulanırken korunur.
- VOTEX 0.4.39 Windows setup üretildi.

---

## 0.4.38 — 9 Eylül 2026

### Legacy Etiket ve Tomografi Görünürlük Düzeltmesi

- Legacy3DMAG obje etiketleri artık adım filtresi ve Basit görünüm profili nedeniyle kaybolmuyor.
- Tomografi dilimleri adım/tespit görünürlük filtresinden bağımsız korunuyor.
- Eski arşivlerde yalnızca `residual_preview` bulunan sonuçlardan da tomografi katmanı üretilebiliyor.
- JSON arşivi açıldığında Tomografi butonu kullanılabilirlik durumunu doğru yansıtıyor.
- Tomografi katmanı daha okunabilir olacak şekilde opaklık ve çizim harmanlama ayarları iyileştirildi.
- Legacy etiket ve tomografi regresyon testleri eklendi/güncellendi.
- VOTEX 0.4.38 Windows NSIS setup üretildi.

---

## 0.4.37 — 9 Eylül 2026

### İsteğe Bağlı Legacy3DMAG Yeraltı Tomografi Katmanı

- JSON `gridValues/gridCoverage` verisinden türetilen çoklu derinlik dilimleri eklendi.
- LEGACY3DMAG paneline tek butonla açılıp kapatılabilen `▦ Tomografi` kontrolü eklendi.
- Tomografi katmanı ana yapı geometrilerinden ayrı tutulur; oda, tünel, şaft, metal, seçim, X-Ray ve kesit akışlarını bozmaz.
- Ölçülmemiş grid hücreleri şeffaf bırakılır; pozitif/negatif manyetik değerler farklı renklerle gösterilir.
- Tomografi materyalleri ve texture'ları kapatılırken dispose edilerek tekrar açma/kapama sızıntısı önlendi.
- Basit görünüm profilinde tomografi katmanı teknik grid gibi yanlışlıkla gizlenmez.
- Tomografi katmanı için 3 yeni test eklendi.
- VOTEX 0.4.37 Windows NSIS setup metadata'sı güncellendi.

---

## 0.4.36 — 9 Eylül 2026

### Prosedürel 3D Çizim Motoru İlk Sürümü

- Legacy3DMAG JSON verisi için ortak normalize edilmiş renderer modeli eklendi.
- Oda, kemerli tünel ve şaft geometrileri nesne türüne göre prosedürel olarak üretilir.
- Ölçüm konturları oda hacmine dönüştürülür; iç hacim, taban ve kenar detayları eklenir.
- Metal sonuçları polarity, güç ve confidence değerlerine göre çekirdek, sinyal kabuğu ve deterministik plume noktalarıyla gösterilir.
- Yeni gerçekçi katman mevcut Legacy3DMAG çizimlerinin üzerine bağlanarak eski seçim, adım filtresi, X-Ray ve derinlik cetveli akışları korunur.
- Renderer normalizasyonu ve tür bazlı geometri için 4 yeni test eklendi; ilgili toplam doğrulama 19 teste ulaştı.
- VOTEX 0.4.36 Windows NSIS setup metadata'sı güncellendi.

---

## 0.4.35 — 9 Eylül 2026

### 2D–3D Kontur Hizalama Düzeltmesi

- Normalize ölçüm konturları 3D gövdeye aynı global plan dönüşümüyle aktarılır.
- Ölçülmüş poligon gövdesi lokal merkez etrafında üretilir; merkez ikinci kez uygulanmaz.
- 2D kontur, 3D gövde, yüzey izdüşümü ve derinlik kılavuzu aynı fiziksel ayak izini kullanır.
- 2D/3D koordinat hizalama regresyon testleri eklendi.
- VOTEX 0.4.35 Windows NSIS setup üretildi.

---

## 0.4.34 — 9 Eylül 2026

### JSON 3D Akış Hata Düzeltmesi

- JSON seçimi sonrası 3D üretimini durduran tanımsız koordinat değişkeni giderildi.
- Metal tespit etiketindeki tanımsız derinlik değişkeni düzeltildi; analiz sonucu ve 3D sahne aynı akışta tamamlanır.
- JSON analizinden sonra boş ekran yerine sonuçların görünmesi sağlandı.
- VOTEX 0.4.34 Windows NSIS setup üretildi.

---

## 0.4.33 — 9 Eylül 2026

### JSON Analiz Uyumluluk Düzeltmesi

- JSON analizinde `scan` içindeki pandas biçiminin yanında kök `columns/data`, `rows` ve `records` biçimleri desteklendi.
- `x/y/z`, `Bx/By/Bz`, `magnetic_*` ve `pos_*` konum/manyetik sütun adları tanınır hale getirildi.
- Metadata alanlarında camelCase ve alternatif metre alanları desteklendi.
- JSON veri okunamadığında boş sonuç yerine açıklayıcı hata döndürülmesi sağlandı.
- JSON parser için iki regresyon testi eklendi.
- VOTEX 0.4.33 Windows NSIS setup üretildi.

---

## 0.4.32 — 9 Eylül 2026

### Tespit Ölçüsü ve Hacim Tutarlılığı

- Tespitlerin genişlik, uzunluk ve yükseklik ölçülerinden hacim `m³` olarak hesaplanır.
- 3D tespit gövdeleri rapordaki fiziksel ölçülerle aynı ölçekte çizilir.
- Tespit kartları ve 3D bilgi pencerelerinde ölçü ve hacim gösterilir.
- Hacim hesaplama yardımcıları ve regresyon testleri eklendi.
- VOTEX 0.4.32 Windows NSIS setup üretildi.

---

## 0.4.31 — 9 Eylül 2026

### 3D Koordinat Sözleşmesi ve Kenar/Köşe Konumlandırma Düzeltmesi

- Normalize görüntü koordinatları ile metre tabanlı CSV/terrain koordinatları ortak dönüşüm yardımcılarında ayrıştırıldı.
- Oda, şaft, metal, su, tünel ve metal alarm katmanları aynı koordinat sözleşmesini kullanıyor.
- Metre cinsinden tünel uçlarının ve tespit merkezlerinin `0–1` aralığına kıskaçlanıp köşeye kayması engellendi.
- CSV yapı sonuçlarında koordinat birimi açıkça `meters` olarak işaretlendi.
- Kenar/köşe konumlandırması için regresyon testleri eklendi.
- VOTEX 0.4.31 Windows NSIS setup üretildi.

---

## 0.4.30 — 9 Eylül 2026

### Tespit Paneli Görünürlük ve Genişlik Düzeltmesi

- `modelById` kapsam hatası giderildi; analiz sonrası tespit kartlarının yeniden görünmesi sağlandı.
- Sol paneldeki tespit/adım listesi dar kutu yerine daha geniş ve kaydırılabilir alana taşındı.
- Tespit filtreleri ve adım kartları korunarak okunabilirlik iyileştirildi.
- VOTEX 0.4.30 Windows NSIS setup üretildi.

---

## 0.4.29 — 9 Eylül 2026

### Sol Panel Tespit Filtreleri ve Okunabilirlik

- LEGACY3DMAG sol panelindeki tarama adımları; adım numarası, hat metresi, adım aralığı, tespit sayısı ve açıklık bilgileriyle düzenli kartlara ayrıldı.
- Tespit kartları ayrı başlık altında gösterilir; hat metresi, adım aralığı, derinlik, güven, offset ve boyut bilgileri birlikte okunabilir.
- Tümü, Sadece tespitler, Güçlü, Dikkat ve Normal filtreleri eklendi.
- Filtreler adım kartlarını ve tespit kartlarını aynı saha modeli üzerinden birlikte süzer.
- Dar ekranlarda kart metrikleri tek sütuna düşürülerek taşma azaltıldı.
- VOTEX 0.4.29 Windows NSIS setup üretildi.

---

## 0.4.28 — 8 Eylül 2026

### 3D Kullanıcı Görünümü ve İnceleme Araçları

- Tespit odaklı kamera, seçili tespit kılavuzları ve üstten/önden/yandan/perspektif hazır kamera görünümleri eklendi.
- Basit, Teknik ve Saha görünüm profilleriyle teknik katmanlar ve saha işaretleri hızlıca sadeleştirilebilir.
- Terrain LOD, derinlik dilimi animasyonu, kesit düzlemi ve manuel manyetik renk ölçeği kontrolleri kullanıcı akışına bağlandı.
- 3D ölçüm, seçili tespit ile 2D harita vurgusu ve rapor akışı birbirine bağlandı.
- VOTEX 0.4.28 Windows NSIS setup üretildi.

---

## 0.4.27 — 8 Eylül 2026

### LEGACY3DMAG Şekil Konumlandırma Düzeltmesi

- Ölçüm konturları artık gerçek tespit merkezine alan ağırlıklı merkez ile ankrajlanır; şekillerin harita köşesine kayması engellenir.
- Normalize `0–1` konturlar ile eski metre tabanlı konturlar ayrıştırılarak doğru dünya koordinatına çevrilir.
- Ölçülmüş geometri, merkez koordinatının ikinci kez uygulanmasını önlemek için lokal koordinat sisteminde oluşturulur.
- Metal gövdesi, çekirdeği, yüzey izdüşümü ve derinlik kılavuzu aynı hedef merkezini kullanır.
- Polygon dönüşümü için regresyon testleri eklendi.
- VOTEX 0.4.27 Windows NSIS setup üretildi.

---

## 0.4.26 — 8 Eylül 2026

### Saha Sonucu ve Adım–Tespit Birleşimi

- LEGACY3DMAG için ortak adım–tespit saha modeli eklendi; hat metresi, adım içi offset ve derinlik aralığı birbirinden ayrıştırıldı.
- Her tespit bağlı olduğu tarama adımı, güven seviyesi, güç değeri, geometri kaynağı ve saha doğrulama önerisiyle gösterilir.
- Sol panelde adımlar tespit sayısı ve NORMAL/DİKKAT/GÜÇLÜ durumuyla listelenir; adım seçimi kamerayı ilgili hatta taşır.
- Tespitler bağımsız kartlar olarak "3D’de göster" ve "Sadece bunu göster" eylemleriyle ayrıştırılır.
- Sağ Analiz Raporu, LEGACY3DMAG verisinde Saha Sonucu özetine ve ayrı tespit kartlarına dönüşür.
- 3D, sol panel ve sağ rapor seçimleri aynı tespit/step state’ini kullanır.
- Ortak saha modeli için 3 yeni regresyon testi eklendi.
- VOTEX 0.4.26 Windows NSIS setup üretildi.


## 0.4.25 — 8 Eylül 2026

### Terrain LOD ve Derinlik Dilimi Görünümü

- Kamera mesafesine göre terrain geometrisi yakın/orta/uzak LOD seviyeleri arasında otomatik değiştirilir.
- Uzak görünümde daha hafif geometri kullanılarak büyük haritalarda GPU ve bellek maliyeti azaltılır.
- CSV derinlik dilimi görünümü seçili Y bandını 3D hacimde yarı saydam plaka ve kenar çizgileriyle gösterir.
- Derinlik slider'ı seçilen dilimin noktalarını, 2D heatmap'i, 3D overlay'i ve yapı raporunu birlikte günceller.
- Seçili dilim bilgisi overlay metadata'sında korunur.
- Yeni LOD regresyon testi eklendi.
- VOTEX 0.4.25 Windows NSIS setup üretildi.

## 0.4.24 — 8 Eylül 2026

### Terrain ve Manyetik Overlay İyileştirmeleri

- Seyrek veri alanları için deterministik multi-octave procedural terrain relief eklendi; veri kabartması korunurken yüzeye düşük genlikli doğal mikro-relief verilir.
- Heightfield türevlerinden tangent-space normal map ile zemin ışıklandırması ve mikro-relief görünümü güçlendirildi.
- Manyetik overlay yoğunluğa göre adaptif 64/128/256 grid kullanır; yüksek yoğunluklu CSV verilerinde ayrıntı korunurken seyrek veride gereksiz maliyet azaltılır.
- Manyetik gradyan modu, yön okları ve iso-nT kontur çizgileri korunarak daha okunabilir hale getirildi.
- Yeni terrain noise ve adaptif grid regresyon testleri eklendi.
- VOTEX 0.4.24 Windows NSIS setup üretildi.

## 0.4.23 — 8 Eylül 2026

### Seçili Tarama Adımı Görünümü

- LEGACY3DMAG panelinde tarama adımları artık ayrı ve tıklanabilir kartlar olarak gösterilir.
- Seçilen adımın işareti, etiketi ve ilgili anomalileri 3D ekranda görünür; diğer adımlar gizlenir.
- Seçim değiştiğinde 3D görünüm anında güncellenir.
- VOTEX 0.4.23 Windows NSIS setup üretildi.

## 0.4.22 — 8 Eylül 2026

### 3D Tarama Adımları ve Okunabilirlik

- Tüm tarama adımları 3D ekranda aynı anda, birbirinden bağımsız işaret ve etiketlerle gösterilir.
- Adım etiketleri yolun iki tarafına dağıtılarak üst üste binme azaltılır.
- Analiz raporu penceresi genişletildi ve uzun sonuç metinleri için satır taşması düzeltildi.



### Geçişler Arası Interpolasyon (IDW) — Kontür Doğruluğu

- Yeni `interpolate_pass_gaps`: fiziksel hücre boyu eksenler arasında ≥1,6× farklıysa (geçiş aralığı ≫ adım aralığı), zayıf eksen ızgarası k=2..6 kat yoğunlaştırılır (braket ölçüm satırları arasında lineer enterpolasyon) ve kalan iç boşluklar IDW (p=2) ile doldurulur.
- **Konum eşlemesi korunur:** yeni boyut n2 = k·(n−1)+1, orijinal satır i → i·k; metre koordinatları kaymaz. Median/σ istatistikleri yalnızca ölçülen hücrelerden hesaplandığı için enterpolasyon σ'yı şişirmez; IDW kaynağı da yalnızca ölçülen hücrelerdir.
- Yoğunlaştırılmış ızgara yalnızca analiz boru hattında (blob → MS kontür → şablon eşleştirme) kullanılır; UI'a giden `gridValues`/`gridCoverage` ölçülen çözünürlükte kalır (payload şişmez).
- Tetiklendiğinde sonuç mesajına "IDW ×k" eklenir; simetrik ızgaralarda no-op.
- 2 yeni birim testi: zayıf eksen yoğunlaştırma + konum korunumu (lineer alanda tam değer), iç boşluk IDW dolumu. Toplam 201 Rust + 264 JS testi yeşil.

## 0.4.20 — 7 Eylül 2026

### Şablon Eşleştirme Katmanı: Oda / Tünel / Şaft / Metal

- Yeni `shape_templates` modülü: anomali kontürleri dört şablon maskesiyle (oda = dolu dikdörtgen, tünel = kapsül/stadyum, şaft = iç teğet elips, metal = kompakt daire) 24×24 bbox-normalize ızgarada korelasyonla eşleştirilir. Geometri ağırlığı 0.62 (Dice katsayısı), fiziksel öncüller 0.38 (uzama, kompaktlık, kutup, güç, ölçü).
- En iyi skoru 0.40'ın altında olan şekiller "Belirsiz" olarak raporlanır — zorlama sınıf yok.
- `LegacyShape`'e `templateKind` / `templateScore` / `templateScores` alanları eklendi (eski arşivlerle uyumlu default'larla).
- 3D detay kartlarında ve doğrulama sayfasında "Şablon: Tünel %78" biçiminde gösterilir.
- Doğrulama: izole yuvarlak güçlü tepe → Metal %89, tek hücre genişliği hat → Tünel %86, yatay sırt → Tünel %83.
- 5 yeni birim testi (uzun/kısa/dikdörtgen/kompakt/dejenere durumları); toplam 199 Rust + 264 JS testi yeşil.

## 0.4.19 — 7 Eylül 2026

### Kontür Görselleştirme: 3D + 2D Harita Doğrulaması

- **3D zemin dolumu:** Anomali kartlarının ölçüm kontürü (marching-squares) artık harita düzleminde yarı saydam dolumla da çiziliyor — dış kontür çizgisi + dolum birlikte, kontür kalitesi saha ekranında doğrudan görülüyor.
- **Metal zemin projeksiyonu:** Metallere özgü genel daire diski kaldırıldı; metalin gerçek ölçüm kontürü (tepe × %70) hem dolum hem kontür çizgisi olarak haritada gösteriliyor. Ölçüm kontürü yoksa daire yaklaşımına düşer.
- **2D doğrulama sayfası:** `cargo test dump_contour_verification_fixture` gerçek boru hattından (residual → blob → MS kontür → sınıflandırma) sentetik düşük çözünürlüklü tarama üretip `dev/contour-verify-standalone.html` dosyasına gömer; ısı haritası + dış/çekirdek kontürler + kartlar (tür, güven, RMS, alan, nokta sayısı) tek ekranda doğrulanır. Doğrulama sonucu: tek hücre genişliği hat 31 noktalı kontür + 3.41 m² gerçek alan (eski: 2-4 nokta, sıfır alan).
- Dikdörtgen dalı MS kontürüne uyarlandı (rectangularity ≥ 0.82, ≤ 16 nokta) — yumuşak köşeli plato kontürleri artık dikdörtgen olarak sınıflanabiliyor; elips rectangularity'si (π/4≈0.785) eşiğin altında güvende.
- Yeni JS testleri (footprintPoints/createFootprintFill) ve Rust fikstür testi ile toplam 194 Rust + 264 JS testi yeşil.

## 0.4.18 — 7 Eylül 2026

### Şekil Motoru v2 — Ölçüme Dayalı Gerçek Şekiller

- **Bikübik ×4 büyütme + marching-squares kontür:** Düşük çözünürlüklü taramalarda (ör. 14 adım × ~3 geçiş) anomali kontürleri artık açı sıralı hücre dizilimi yerine, blob çevresindeki yerel pencerenin Catmull-Rom bikübik ile ×4 büyütülüp tepe eşiğinde (metal için %70, genel için algılama eşiği) marching-squares izo-kontürü çıkarılmasıyla üretiliyor. Tek hücre genişliğindeki anomaliler bile 8+ noktalı, gerçek alanlı, kapalı poligon veriyor — "Düzensiz %4" tabanına düşüş ortadan kalktı.
- **Ağırlıklı moment elipsi:** Blob hücreleri |rezidü| değerleriyle ağırlıklandırılıp 2. moment kovaryansından yönelim + eksen oranı hesaplanıyor; 2–3 hücrelik blob'larda bile kararlı.
- **Gerçek RMS:** Kartlardaki "RMS" artık uydurma bir kalite türevi değil — kontür noktalarının moment elipsine gerçek en-yakın-nokta RMS sapması (ternary arama ile). Circle/ellipse/capsule sınıflarında sezgisel model hatasının yerine ölçülen göreli sapma geçti.
- Kontür dejenere kalırsa (çok nadir) önceki davranış korunuyor: rx/ry tabanlı tahmini sınıflandırma, "hesaplanmış" kaynak etiketi.
- 5 yeni regresyon testi: bikübik doğrusallık, marching-squares kapalı döngü/alan doğruluğu, tek hücre genişliği blob, moment elips eksen oranı, elips RMS sıfır yakınsaması.
- Bakım: `structures` modülündeki 3 önceden var olan test uyarısı temizlendi (tüm hedeflerde 0 uyarı).

## 0.4.17 — 7 Eylül 2026

### 3D Etiket Okunabilirliği ve Tür Bilgisi

- 3D anomali etiketleri artık ne olduğunu gösteriyor: sıra numarası + tür (örn. `#2 · Elips`, `#7 · Metal`) — "Anomali" kelimesi kaldırıldı.
- Etiket punto büyütüldü (başlık 18→25 px, detay 14→17 px; güçlü anomali 28→32 px) ve sprite boyutu %40 artırıldı — saha ekranında okunabilir.
- Güçlü anomali etiketi yalnızca kırmızı-beyaz: kırmızı çerçeve + koyu kırmızı zemin + beyaz yazı.
- Etiketler büyüdüğü için şerit/satır aralığı genişletildi; üst üste binme azaltıldı.

---

## 0.4.16 — 7 Eylül 2026

### LEGACY3DMAG Dejenere Kontür Düzeltmesi (Düzensiz %4 Sorunu)

- Düşük çözünürlüklü JSON taramalarda tek hücre genişliğindeki anomalilerin ölçüm kontürü doğrusallaşıyor (sıfır alan) ve sınıflandırıcı her seferinde "Düzensiz - şekil %4 - RMS 1.00" tabanına düşüyordu.
- `classify_shape` artık dejenere kontürü algılıyor (3'ten az nokta veya alan ≈ 0) ve şekli sığdırılmış rx/ry ölçüsünden sınıflandırıyor: en/boy ≤ 1.25 → tahmini Daire, ≥ 2.2 → tahmini Kapsül, arası → tahmini Elips.
- Dejenere kontürlerde `shape_source` artık `inferred` (arayüzde "hesaplanmış") işaretleniyor; anlamsız RMS 1.00 yerine dürüst güven değerleri (%47–%56 bandı) üretiliyor.
- 3D katman, dejenere durumlarda kırık ölçüm kontürü yerine temiz sığdırılmış elips geometrisi çiziyor.
- Düzeltme: `classify_shape` içinde kullanılmayan `kind` parametresi temizlendi; 0 uyarı kuralı korundu.
- Regresyon testi eklendi: `degenerate_contour_falls_back_to_fitted_shape` (188/188 Rust, 258/258 JS testi geçti).
- Sürüm metadata'sı tüm konumlarda 0.4.16'ya senkronize edildi.

---

## 0.4.15 — 7 Eylül 2026

### 🧭 Modül Üst Sekmeleri ve Saha Katmanı Güçlendirmesi

- Sol menü GÖRÜNTÜ / CSV VERİ / LEGACY3DMAG / ARAÇLAR modülleri ayrı üst sekmelere ayrıldı; aktif olmayan modülün kontrolleri gizleniyor.
- Sekme geçişleri mevcut DOM düğümlerini taşıyarak yapılıyor; tüm kontrol ID'leri ve main.js bağlayıcıları korunuyor.
- Manyetik zemin overlay'i genişletildi: sparse-grid en yakın geçerli hücre dolgusu, gradyan alanı (|∇B|) + yön okları, marching-squares iso-nT kontur segmentleri ve `binToGroundGrid` dışa aktarımı.
- LEGACY3DMAG JSON analizi için backend `analyze_legacy_dik_json` komutu adım sayısı (max 10000) ve adım ölçüsü doğrulamasıyla eklendi.
- Votex-WASM'a `detect_wall_cues` portu eklendi: beyaz duvar ipuçları + yeşil tünel çizgi segmentleri mobil 3D yüzey hattına aktarılıyor.
- Metal builder ve arşiv modülü genişletildi; resim işleyici testleri güncellendi.
- Düzeltme: `legacy_mag_json.rs` içinde footprint metriklerinin taşınan `polygon` değerinden sonraya kalan ödünç alma hataları (E0382) giderildi.
- Düzeltme: `votex-wasm/src/surface.rs` içindeki yinelenen `is_near_white` tanımı çözüldü (RGB varyantı `is_near_white_rgb` olarak adlandırıldı).
- Sürüm metadata'sı package.json, tauri.conf.json, Cargo.toml, Cargo.lock, Inno Setup ve birleşik setup yapılandırmalarında 0.4.15'e senkronize edildi.

---

## 0.4.14 — 7 Eylül 2026

### LEGACY3DMAG Adım Sayısı Öncelik Düzeltmesi

- Kullanıcı açıkça adım sayısı girdiğinde bu değer artık koordinatlardan türetilen sayı tarafından değiştirilmiyor.
- Örneğin `12` adım girildiğinde analiz sonucu ve 3D tarama cetveli tam olarak 12 adım kullanıyor.
- Yatay adım ölçüsü yalnızca adım sayısı boş veya `0` olduğunda otomatik segment hesabında kullanılıyor.
- Adım sayısı ile yatay açıklık alanlarının görevleri arayüzde ayrıştırıldı.
- Bu davranış için backend regresyon testi eklendi.

---

## 0.4.13 — 7 Eylül 2026

### LEGACY3DMAG Kullanıcı Adımı ve Anomali Detayları

- LEGACY3DMAG paneline kullanıcı tarafından girilebilen yatay adım ölçüsü (metre) eklendi.
- Girilen ölçü, JSON koordinatlarından analiz segmentlerini ve adım sayısını üretir; adım sayısı boşsa mevcut JSON segmentleri korunur.
- Her anomali ayrı kartta şekil, kaynak, merkez, derinlik, boyut, şekil güveni, RMS uyum hatası ve en yakın tarama adımıyla gösterilir.
- Anomali kartına tıklanınca ilgili 3D hacme odaklanılır; en güçlü anomali görsel olarak öne çıkarılır.
- `scanStepInputM` alanı eklenerek girilen adım ölçüsü arşiv ve JSON sonuçlarında korunur.
- Eski JSON arşivleri geriye dönük uyumlu kalır.

---

## 0.4.12 — 7 Eylül 2026

### LEGACY3DMAG Tarama Adımı ve Yatay Konumlandırma

- JSON analiz sonucu her tarama adımının gerçek yatay merkezini, başlangıç/bitiş koordinatlarını ve kapladığı açıklığı içerir.
- Ardışık adımlar arasındaki gerçek yatay mesafe ve ortalama adım açıklığı hesaplanır.
- 3D JSON katmanında `Adım 1`, `Adım 2` etiketleri, ölçüm yolu ve adımlar arası `Δ metre` göstergeleri eklenir.
- LEGACY3DMAG panelinde hangi adımın nerede olduğu, yatay merkezleri ve adım açıklıkları Türkçe gösterilir.
- Eski arşivler boş varsayılan step listesiyle geriye dönük uyumlu kalır.

---

## 0.4.11 — 7 Eylül 2026

### LEGACY3DMAG JSON Şekil Tabanlı 3D Görselleştirme

- JSON ölçüm grid'indeki anomaliler daire, elips, kare, dikdörtgen, kapsül, çokgen veya düzensiz şekil olarak sınıflandırılır.
- Ölçülmüş grid konturları, uygun olduğunda tahmini şeklin önüne geçirilerek gerçek ayak iziyle 3D hacme dönüştürülür.
- Şekil yönü, genişlik, uzunluk, yuvarlaklık, şekil RMS uyum hatası ve şekil güveni analiz sonucuna eklenir.
- 3D görünümde yüzey izdüşümü, derinlik kılavuzu ve ölçülmüş/tahmini geometri ayrımı gösterilir.
- Seçim paneli şekil uyumunu derinlik uyumundan ayrı gösterir; eski JSON arşivleri varsayılan alanlarla açılmaya devam eder.


---

## 0.4.10 — 6 Eylül 2026

### 🧭 Sol Menü Veri Sekmeleri

- CSV veri içe aktarma, harita, manyetik overlay, GPS, hizalama ve filtreleme kontrolleri ayrı **CSV VERİ** sekmesine taşındı.
- LEGACY3DMAG JSON tarama, adım sayısı ve analiz kontrolleri ayrı **LEGACY3DMAG** sekmesine ayrıldı.
- Analiz araçları, raporlar, dışa aktarma, oturum, 3D ölçüm ve derinlik profili ayrı **ARAÇLAR** sekmesinde toplandı.
- Mevcut kontrol kimlikleri korundu; mevcut analiz ve arşiv akışları bozulmadan çalışır.

---

## 0.4.9 — 6 Eylül 2026

### 📦 Eski Sürümü Kaldırarak Güncelleme

- Yeni birleşik setup, kurulumdan önce çalışan VOTEX sürecini kapatır.
- Önceki VOTEX/Tauri ve DFT Suite kurulumları sessizce kaldırılır; ardından VOTEX 0.4.9 ve DTA yeniden kurulur.
- Kullanıcı verileri, arşivler ve `%APPDATA%` ayarları kaldırılmaz.
- Kurulum AppId'si sabit tutulduğu için sonraki güncellemeler yükseltme olarak algılanır.
- Sürüm metadata'sı VOTEX, Tauri, Cargo ve birleşik setup yapılandırmalarında 0.4.9'a yükseltildi.

---

## 0.4.8 — 6 Eylül 2026

### 🧭 JSON Derinlik Uyum Hatası ve Belirsizlik Görselleştirmesi

- JSON derinlik tahminlerine yöntem, normalize RMS uyum hatası ve kullanılan örnek sayısı eklendi.
- Dipol tahminleri için uyuma ve ölçüm çözünürlüğüne dayalı derinlik belirsizlik aralığı üretildi.
- Peters ve sezgisel tahminler açıkça düşük/uygulamalı uyum olarak işaretleniyor; eski arşiv kayıtları geriye dönük uyumlu kalıyor.
- 3D JSON katmanında her anomalinin çevresine belirsizlik hacmi ve renk kodlu derinlik aralığı etiketi eklendi.
- Seçim bilgi panelinde yöntem, RMS hata, belirsizlik aralığı ve fit örnek sayısı gösteriliyor.
- 0.4.8 sürüm metadata'sı Tauri, NSIS ve birleşik setup yapılandırmalarında senkronize edildi.

---

## 0.4.5 — 6 Eylül 2026

### 🖼️ Resim İşleme Tabanlı Kenar ve Kontur Analizi

- Resim analiz pipeline'ına 2B sonlu fark gradyanı eklendi; `|∇B|`, X/Y yönleri, ortalama ve maksimum gradyan değerleri hesaplanıyor.
- Güçlü gradyan hücreleri kenar/anomali göstergesi olarak sayılıyor ve analiz sonucuna aktarılıyor.
- Resimden üretilen manyetik grid için marching-squares yöntemiyle iso-nT kontur segmentleri oluşturuluyor.
- Kenar okları ve iso-nT konturları 2D resim önizlemesinde ve birleşik haritada görünür hale getirildi.
- İşlem sonucu metrikleri ana arayüze ve Türkçe saha raporuna eklendi; rapor bunların tek başına yapı/metal kanıtı olmadığını açıkça belirtir.
- Rust desktop analiz sonucu ile JavaScript birleşik analiz sonucu aynı `edgeAnalysis` veri sözleşmesini kullanıyor.
- 0.4.5 sürüm metadata'sı, Tauri/NSIS ve birleşik setup yapılandırmalarında senkronize edildi.

---

## 0.4.4 — 5 Eylül 2026

### 🧭 Magnetic Terrain Relief & Edge Analysis

- Added tangent-space normal-map generation from terrain heightfield derivatives for subtle lit relief.
- Added magnetic gradient magnitude (`|∇B|`) display mode for edge detection.
- Added gradient direction arrows and iso-nT contour line overlays.
- Added sparse-grid handling, contour interpolation, clipping/disposal integration, and regression tests.
- Updated the unified VOTEX + DTA setup metadata to version 0.4.4.

---

## 0.4.2 — 4 Eylül 2026

### 🎨 Harita Renklendirme (Analizden Önce)

- **2D Harita Renklendirici** — 8 hazır palet ile zemin dokusu renklendirmesi:
  - Manyetik Yoğunluk, Derinlik, Termal, Askeri, Okyanus, Gri Tonları, Metal Avcısı, Kapalı
  - Analizden önce renk şeması seçme — 2D önizlemede hemen görünür
  - Ham ELIC görseli her zaman korunur → tamamen geri dönüşümlü

- **Palette Önizleme Küçük Resimleri** — Renk şemaları küçük gradyan canvas ile gösterilir:
  - Her palet için 32×14px mini gradient Thumbnail
  - Seçili palet yeşil kenarlık + parlama ile vurgulanır
  - Hover'da kenarlık rengi değişir

- **Yumuşak Geçiş Animasyonu** — Palette değişimlerinde crossfade:
  - 250ms ease-out quad animasyon
  - 200ms ease-in fade-out (renk kapatıldığında)
  - Hızlı palette değişimlerinde önceki animasyon iptal edilir

- **Opacity Kaydırıcısı** — Renk katmanı şeffaflığı:
  - 0–100% arası karıştırma
  - Gerçek zamanlı slider güncelleme
  - Crossfade animasyonunda bile korunur

- **PNG Dışa Aktarma** — Renklendirilmiş haritayı indirme:
  - Tam çözünürlükte (naturalWidth × naturalHeight)
  - Otomatik dosya adı: `{dosyaadı}_{palet}.png`

- **Geri Al / İleri Al** — Renklendirme işlemleri geri alınabilir:
  - Ctrl+Z / Ctrl+Y ile palette geçişleri
  - Undo butonu renklendirme barında

---

## 0.4.1 — 2 Eylül 2026

### 🤖 Yerel Yapay Zeka Entegrasyonu

- **AI Server** — FastAPI + Ollama tabanlı yerel AI servisi:
  - Görüntü analizi (llava, moondream ile manyetik harita yorumlama)
  - Anomali tespiti (manyetik veri AI ile analiz)
  - Rapor üretme (otomatik jeofizik rapor)
  - Genel sohbet (VOTEX hakkında yardım)
  - Streaming yanıtlar (SSE + WebSocket)
  - Model indirme/yönetme

- **AI Paneli** — VOTEX içi AI arayüzü:
  - Ctrl+I kısayolu veya 🤖 butonu ile açılır
  - Sunucu bağlantı ayarları
  - Model seçimi ve indirme
  - Hızlı analiz butonları (görsel, anomali, rapor)
  - Streaming sohbet arayüzü

- **AI Client** — JS modülü:
  - REST + SSE + WebSocket desteği
  - Otomatik model seçimi
  - Bağlantı yönetimi

---

## 0.4.0 — 2 Eylül 2026

### 🎨 Görsel İyileştirmeler

- **🔴 Metal Builder Dönüşümü** — Basit kutulardan gelişmiş 3D görsellere:
  - `RoundedBoxGeometry` ile yuvarlatılmış köşeler (artık sivri kutu yok)
  - Strength-orantılı glow küreleri (fieldStrength > 0.5 için parlak halo)
  - EmissiveIntensity artık strength'e bağlı (0.3 → 0.8 arası)
  - Hostsuz metaller için küre + kutu kombinasyonu
  - Shaft-hosted metaller için koni ucu eklendi

- **🟦 Chamber iyileştirmeleri** — Mağara atmosferi:
  - Vertex noise ile kayamsı duvar dokusu
  - Zemin gradyanı (merkezden kenara koyulaşan renk)
  - İç parıltılar (AdditiveBlending ile mağara partikülleri)

- **🟩 Tunnel kısa tünel yükseltmesi**:
  - Plain box → `RoundedBoxGeometry` yuvarlatılmış koridor
  - İç karanlık katman (BackSide mesh)
  - Zemin plakası
  - Periyodik ışık noktaları + PointLight (her ~2.5m)

- **🟨 Shaft su yansıması**:
  - 3m+ derin şaftlar için mavi yansıma diski
  - Su partikülleri (AdditiveBlending damlacıklar)

### ✨ Yeni Özellik

- **⚡ AUTO — Akıllı Ayar Sistemi** — Veriye göre parametreleri otomatik ayarlar:
  - **Veri Profili Çıkarıcı** (`dataProfiler.js`): Görselden renk dağılımı (kırmızı/yeşil/mavi anomali oranı, LUT güveni, gürültü göstergesi), CSV'den yoğunluk/SNR/boşluk oranı çıkarır
  - **Kural Tabanlı Motor** (`autoTune.js`): 10 kritik analiz parametresi için deterministik, açıklanabilir kurallar — Grid çözünürlüğü, tespit eşiği, min güç, sigma, havuz boyutu, sığdırma, dilim sayısı, nokta boyutu, hibrit ağırlık, min güven
  - **Öğrenme Döngüsü**: AUTO sonrası elle değiştirdiğiniz ayarlar profil tipine göre hatırlanır — aynı tip veride sonraki sefer otomatik uygulanır
  - **Şeffaf Öneri Kartı**: Her ayarın yanında gerekçesi görünür (örn. "Gürültülü veri SNR 1.2 → eşik 1.3")
  - **⚡ AUTO butonu**: "Dosya Seç" ile "Analizi Başlat" arasında — tek tıkla profil çıkar, önerir, uygular
  - Saha kullanımı için: 30 slider'ı anlamak yerine veriyi yükleyip AUTO'ya basmak yeter

### 🧠 Öğrenme Mimarisi

- Profil parmak izi (`hashProfile`): Benzer veriler kaba bucket'lara yuvarlanır — aynı tip saha verisi aynı öğrenme kaydına düşer
- Kullanıcı override'ları `localStorage`'da tutulur (maks. 60 profil), her parametre için clamp'lenir
- Kartta 🧠 işareti = o ayar önceki tercihinizden öğrenildi

### 🔧 Teknik

- Versiyon senkronize: `package.json`, `tauri.conf.json`, `Cargo.toml` → **0.4.0** (0.3.14/0.3.17 karışıklığı giderildi)
- Pencere başlığı güncellendi: "Votex 0.4.0 — Magnetic Anomaly Analysis"
- i18n: TR + EN tam destek (`auto.*` anahtarları)
- 12 yeni birim testi (`autoTune.test.js`) — profil istatistikleri, kural seti, öğrenme döngüsü, clamp sınırları

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/hybrid/dataProfiler.js` | 🆕 Veri profili çıkarıcı |
| `ui/hybrid/autoTune.js` | 🆕 Kural tabanlı motor + öğrenme döngüsü |
| `ui/ui/autoTunePanel.js` | 🆕 Öneri kartı + buton mantığı |
| `ui/hybrid/__tests__/autoTune.test.js` | 🆕 12 birim testi |
| `index.html` | ⚡ AUTO butonu + öneri kartı + stiller |
| `ui/main.js` | Entegrasyon (bindAutoTune + locale reset) |
| `ui/i18n/locales.js` | TR/EN `auto.*` anahtarları |
| `package.json` / `tauri.conf.json` / `Cargo.toml` | Versiyon → 0.4.0 |

---

## 0.4.0 — 2 Eylül 2026

### 🔧 Düzeltmeler

- **🔴 Alarm Koordinat Hassasiyeti** — Alarm sphere'ları artık `buildMesh`'in hesapladığı `_computedMapW/_computedMapD` değerlerini kullanıyor, tekrar hesaplama kaymaları tamamen kaldırıldı

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/main.js` | 🔧 `_computedMapW/D` fallback |
| `ui/viewer/mesh.js` | 🔧 `_computedMapW/D` cache |
| `package.json` | Versiyon → 0.3.18 |
| `src-tauri/tauri.conf.json` | Versiyon → 0.3.18 |
| `src-tauri/Cargo.toml` | Versiyon → 0.3.18 |
| `CHANGELOG.md` | 0.3.18 notları |

---

## 0.3.17 — 1 Eylül 2026

### 🔧 Düzeltmeler

- **🔴 Alarm mapW/mapD Koordinat Düzeltmesi (kritik)** — Alarm sphere'ları artık metal pin marker'ların tam XZ konumunda oluşuyor:
  - Builder `surface.mapWidthM ?? surface.map_width_m ?? surface.mapSizeM ?? surface.map_size_m ?? 24` kullanıyordu
  - Alarm sadece `surface.map_width_m || 30` kullanıyordu — farklı fallback → farklı koordinat
  - Şimdi alarm da aynı fallback zincirini kullanıyor

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/main.js` | 🔧 `activateMetalAlarm()` mapW/mapD fallback düzeltmesi |
| `package.json` | Versiyon → 0.3.17 |
| `src-tauri/tauri.conf.json` | Versiyon → 0.3.17 |
| `src-tauri/Cargo.toml` | Versiyon → 0.3.17 |
| `CHANGELOG.md` | 0.3.17 notları |

---

## 0.3.16 — 1 Eylül 2026

### 🔧 Düzeltmeler

- **🔴 Metal Alarm Konum Düzeltmesi (kritik)** — Alarm sphere'ları artık SADECE image analizinden gelen metallere göre konumlandırılır:
  - `applySurface`'ten alarm aktifleştirmesi kaldırıldı
  - Alarm sadece `build3D()`, `runDeepScan()`, `runStagedScan()`, `runWaterScan()` yollarında aktive ediliyor
  - DTA, Prob Engine, CSV gibi dış kaynaklar artık alarm'ı tetiklemez
  - Önceki sorun: DTA/CSV surface'ları alarm'ı yanlış metal konumlarına taşıyordu

- **🔴 Zemin Gölge Halkası** — Her alarm sphere'ının altında kırmızı ışık dairesi (pulsing)

- **🔴 vertExag Orantılı Ölçek** — Alarm sphere'ları sahne dikey abartısına göre ölçeklenir

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/main.js` | 🔧 `activateMetalAlarm()` helper + alarm yolları |
| `ui/viewer/metalAlarm.js` | 🔧 Konum + gölge + vertExag ölçek |
| `package.json` | Versiyon → 0.3.16 |
| `src-tauri/tauri.conf.json` | Versiyon → 0.3.16 |
| `src-tauri/Cargo.toml` | Versiyon → 0.3.16 |
| `CHANGELOG.md` | 0.3.16 notları |

---

## 0.3.15 — 1 Eylül 2026

### 🔧 İyileştirmeler

- **🔴 Metal Alarm Konum Düzeltmesi (kritik)** — Alarm sphere'ları artık image analizindeki metal tespitlerinin tam üzeri konumunda:
  - Eski kod derinliğe bağlı Y hesaplamasıyla sphere'ları yerin altına atıyordu
  - Y konumu sabit y=1.2 (zeminin hemen üstü) olarak düzeltildi
  - XZ koordinatları `mapToWorld()` ile doğru hesaplanıyordu, sadece Y sorunluydu

- **🔴 Zemin Gölge Halkası** — Her alarm sphere'ının altında kırmızı ışık dairesi:
  - `RingGeometry(0.4, 1.2)` — iç/dış yarıçaplı halka
  - Zemin seviyesinde yatay (rotation.x = -PI/2)
  - Pulsing animasyonu (boyut + opaklık dalgalanması)
  - Metal tespitlerinin harita üzerinde konumunu belirginleştirir

- **🔴 vertExag Orantılı Ölçek** — Alarm sphere'ları sahne dikey abartısına göre ölçeklenir:
  - `scale = clamp(0.6 + vertExag * 0.4, 0.5, 2.0)`
  - Tüm animasyonlar (core, halo, shadow, ışık) baseScale ile çarpılıyor
  - Küçük sahne → daha küçük alarm, büyük sahne → daha büyük alarm

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/viewer/metalAlarm.js` | 🔧 Konum düzeltmesi + gölge halkası + vertExag ölçek |
| `package.json` | Versiyon → 0.3.15 |
| `src-tauri/tauri.conf.json` | Versiyon → 0.3.15 |
| `src-tauri/Cargo.toml` | Versiyon → 0.3.15 |
| `CHANGELOG.md` | 0.3.15 notları |

---

## 0.3.14 — 1 Eylül 2026

### ✨ Yeni Özellikler

- **🔴 Metal Alarm Sistemi** — Değerli metal tespitinde sesli uyarı ve görsel alarm:
  - Web Audio API ile sinüs dalgası beep sesi (880→1100 Hz sweep)
  - Her metal yapının üstünde dönen kırmızı ışık topu (pulsing glow)
  - Sürekli tekrar beep — saha ortamında metal kaçırmazsınız
  - Tam kontrol paneli: Alarm aç/kapa, ses aç/kapa, ses seviyesi, beep hızı, ışık hızı
  - Test ses butonu — tek tıkla beep sesini duy
  - Analiz tamamlandığında otomatik aktivasyon
  - Metal yoksa alarm pasif, badge gizlenir
  - Sahne yeniden kurulduğunda otomatik temizleme

### 🔧 İyileştirmeler

- **Metal alarm badge** sağ panelde metal sayısını gösterir
- **Alarm durum satırı** aktif/pasif ve metal sayısını gösterir
- **clearAll()** ile yapı grupları yeniden kurulduğunda alarm sphere'ları temizlenir

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/viewer/metalAlarm.js` | 🆕 Metal alarm modülü (ses + ışık) |
| `ui/main.js` | Alarm entegrasyonu + kontrol bindingleri |
| `index.html` | 🔴 METAL ALARM ağaç menüsü |
| `package.json` | Versiyon → 0.3.14 |
| `src-tauri/tauri.conf.json` | Versiyon → 0.3.14 |
| `src-tauri/Cargo.toml` | Versiyon → 0.3.14 |
| `CHANGELOG.md` | 0.3.14 notları |

---

## 0.3.13 — 1 Eylül 2026

### ✨ Yeni Özellikler

- **🔍 Veri Filtreleme Paneli** — CSV verisini çoklu kritere göre süzme:
  - Manyetik yoğunluk aralığı filtresi (nT)
  - Derinlik aralığı filtresi (m)
  - Yapı türü filtresi (Oda / Tünel / Metal / Şaft)
  - Filtre aktif/bilgi durumu göstergesi
  - Tek tıkla sıfırlama

- **🧩 Otomatik Anomali Kümeleme (DBSCAN)** — Tespit edilen yapıları otomatik gruplama:
  - DBSCAN algoritması ile 3D kümeleme
  - Yakın yapıları otomatik olarak gruplar
  - Küme merkezi, yarıçap ve güven hesaplaması
  - Akıllı öneriler: "Bu 3 oda birbirine yakın — mağara kompleksi olabilir"
  - Sağ panel için HTML formatlı sonuçlar

- **📁 Toplu DTA İşleme** — Aynı anda birden fazla DTA dosyası yükleme:
  - `📁 TOPLU DTA SEÇ` butonu ile çoklu dosya seçimi
  - Sürükle-bırak desteği
  - Dosya format tespiti (SDC, CSV, TSV, YAML)
  - Ondalık ayracı otomatik algılama
  - İlerleme çubuğu ile işleme durumu
  - Sonuç karşılaştırma görünümü

### 🔧 İyileştirmeler

- **Kümeleme butonu** analiz tamamlandığında otomatik aktifleşir
- **Filtre değişikliği** CSV overlay'yi otomatik yeniden oluşturur
- **15 yeni birim testi** (filterPanel + clustering)

### 📁 Dosyalar

| Dosya | Tür |
|-------|-----|
| `ui/ui/filterPanel.js` | 🆕 Veri filtreleme paneli |
| `ui/viewer/clustering.js` | 🆕 DBSCAN kümeleme |
| `ui/ui/batchDta.js` | 🆕 Toplu DTA işleme |
| `ui/ui/__tests__/filterPanel.test.js` | 🆕 5 test |
| `ui/viewer/__tests__/clustering.test.js` | 🆕 10 test |
| `index.html` | 3 yeni ağaç bölümü |
| `ui/main.js` | Entegrasyon |

---

## 0.3.12 — 1 Eylül 2026

### ✨ Yeni Özellikler

- **💾 Oturum Kaydet/Yükle** — Analiz durumunu kaydedin ve geri yükleyin:
  - `💾 Kaydet` butonu ile anlık kaydetme
  - `📤 Dışa Aktar` ile JSON dosyası olarak dışa aktarma
  - Otomatik kayıt (her 5 dakika)
  - Otomatik kayıt yükleme (yeniden başlarken)
  - Ctrl+S kısayolu ile hızlı kaydetme
  - Oturum listesi: yükleme, silme, durum göstergeleri
  - Maksimum 20 oturum saklanır

- **📏 3D Ölçüm Araçları** — 3D sahne üzerinde mesafe ölçümü:
  - `📏 Ölçmeye Başla` butonu ile ölçüm modu
  - İki nokta arası 3D mesafe ölçümü
  - Renkli marker ve çizgi gösterimi
  - Sonuç sprite olarak sahne üzerinde gösterilir
  - Ctrl+M kısayolu ile hızlı açma/kapama
  - Status bar'da canlı sonuç

- **⌨️ Klavye Kısayolları Yardım Ekranı** — Tüm kısayolları listeler:
  - `?` tuşu ile açma/kapama
  - ESC ile kapatma
  - Kategorilere ayrılmış gösterim (Genel, 3D, Analiz, Etkileşim)
  - Modal pencere içinde zarif tasarım
  - Oturumlar section'ına kısayol yardımı butonu eklendi

### 🔧 Teknik

- **`ui/ui/sessionManager.js`** — 🆕 Oturum yönetim modülü (9 birim testi)
  - `saveSession()`, `loadSession()`, `listSessions()`, `deleteSession()`
  - `autoSave()`, `loadAutoSave()`, `startAutoSave()`
  - `exportSessionJson()`, `importSessionJson()`
- **`ui/viewer/measurementTool.js`** — 🆕 3D ölçüm aracı modülü
  - `startMeasurement()`, `stopMeasurement()`, `isMeasuring()`
  - `handleMeasurementClick()`, `getMeasurementResult()`
- **`ui/ui/shortcutHelp.js`** — 🆕 Kısayol yardım ekranı modülü
- **`ui/main.js`** — Session, measurement ve shortcut help entegrasyonu
- **`index.html`** — OTURUMLAR ve 3D ÖLÇÜM tree-section'ları eklendi

---

## 0.3.11 — 1 Eylül 2026

### ✨ Yeni Özellikler

- **📁 Toplu CSV Yükleme** — Birden fazla CSV dosyasını aynı anda yükleyin:
  - `📁 Toplu Yükle` butonu ile çoklu dosya seçimi (Ctrl+Click ile birden fazla)
  - Sürükle-bırak ile çoklu dosya desteği (birden fazla dosyayı aynı anda bırakın)
  - Dosya listesi paneli — renkli etiketlerle her dosyayı ayrı ayrı yönetin:
    - Görünür/gizli modu toggle
    - Tek tıkla kaldır
    - Dosya adı ve nokta sayısı gösterimi
  - **Birleştir modu** — tüm dosyaları tek 3D sahneye yerleştirin
  - **Ayrı mod** — dosyaları ayrı tutarak karşılaştırma yapın
  - Her dataset için benzersiz renk ataması (10 renk döngüsel)
  - `🧹 Temizle` ile tümünü tek tıkla silme
  - `🔗 Birleştir` / `📋 Ayrı` mod seçimi
  - Boş CSV fallback parse (Rust backend olmadığında basit parse)

### 🔧 Teknik

- **`ui/ui/multiCsvLoader.js`** — 🆕 Çoklu CSV yönetim modülü (10 birim testi)
  - `addFile()`, `addFiles()`, `addCsvContent()` — dosya ekleme
  - `getMergedData()` — tüm görünür dataset'leri birleştirir
  - `removeDataset()`, `clearAll()`, `selectDataset()` — yönetim
  - `setMergeMode()`, `setDatasetVisible()` — mod ve görünürlük kontrolü
- **`ui/ui/csvPanel.js`** — Toplu yükleme butonu, dosya listesi, drop handler güncellendi
- **`index.html`** — `📁 Toplu Yükle` butonu, multi-csv-list container eklendi
- **`ui/ui/__tests__/multiCsvLoader.test.js`** — 🆕 10 birim testi (198 toplam)

## 0.3.10 — 1 Eylül 2026

### ✨ Yeni Özellikler

- **↩️ Undo/Redo Genişletme** — Geri al/ileri al artık tüm işlemleri takip eder:
  - Renk şeması değişikliği (palet geçişleri)
  - Kesit (clipping) modu açma/kapama
  - Kesit yüksekliği değişikliği
  - X-Ray/fresnel görünümü açma/kapama
  - `applyUndoEntry()` yardımcı fonksiyonu ile merkezi undo mantığı
  - Klavye kısayolları (Ctrl+Z/Y) tüm yeni işlemleri destekler

- **📋 PDF Rapor Düzeltmesi** — Dışa aktarılan rapor artık doğru değerleri gösterir:
  - Boş/undefined değerler yerine "—" gösterimi
  - `fmtM()`, `fmtPct()`, `fmtSNR()` yardımcı formatlama fonksiyonları
  - Chamber, tunnel ve metal kartlarında tutarlı veri gösterimi
  - Tarih formatı düzeltilmiş

### 🔧 Teknik

- **Rust Uyarı Temizliği** — 52 uyarı → 0 uyarı:
  - `#![allow(dead_code)]` ile API fonksiyonları korundu
  - Unused import temizliği (`DataType`, `AtomicI8`, `DecisionReport`, `MetalDecision`)
  - `surface::models` modülü `pub(crate)` yapıldı
  - Test importları düzeltildi

- **GitHub Actions CI/CD** — `.github/workflows/ci.yml` eklendi:
  - PR ve push'ta otomatik JS test + Rust test + build
  - Paralel job yapısı (JS ve Rust aynı anda)
  - Rust build cache ile hızlı tekrar derleme
  - 0 uyarı zorunluluğu (uyarı varsa başarısız)

---

## 0.3.9 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **📊 Derinlik Profili Kesiti** — Seçili noktadan yatay veya dikey manyetik yoğunluk profili:
  - 3D sahne üzerinde tıklayarak kesit noktası seçme
  - Yatay (X ekseni) veya dikey (Z ekseni) kesit modu
  - Canvas üzerinde interaktif grafik (nT vs mesafe)
  - Sıfır çizgisi, ızgara, renkli dolgu
  - Seçili nokta belirteci ve istatistikler
  - `depthProfile.js` modülü

### 🔧 Teknik

- `ui/viewer/depthProfile.js` — 🆕 Derinlik profili kesit modülü (slice çıkarma, Canvas çizimi)
- `ui/main.js` — Depth profile import + 3D tıklama event listener + mod seçimi
- `index.html` — 📊 DERİNLİK PROFİLİ accordion (yatay/dikey butonu + canvas)

---

## 0.3.8 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **🗺 Manyetik Zemin Haritası** — CSV manyetik yoğunluk verilerini 3D ground plane'e yarı saydam jet renk haritası olarak ekle:
  - 128×128 piksel çözünürlük
  - Jet colormap (mavi→cyan→yeşil→sarı→turuncu→kırmızı)
  - Ayarlanabilir opaklık (0-100%)
  - Otomatik clip plane senkronizasyonu
  - CSV yüklendiğinde otomatik oluşturma
  - `groundMagneticOverlay.js` modülü

- **🎯 Click-to-Align Aracı** — 2D haritada interaktif referans noktası seçimi:
  - Image canvas üzerinde tıklayarak referans noktaları seçme
  - Kalite skoru hesaplama (RMSE tabanlı)
  - Izgara overlay toggle
  - Nokta temizleme ve yeniden seçme
  - `clickToAlign.js` modülü

### 🔧 Teknik

- `ui/viewer/groundMagneticOverlay.js` — Manyetik zemin overlay modülü (jet colormap, DataTexture, grid binning)
- `ui/hybrid/clickToAlign.js` — İnteraktif hizalama modülü (Canvas pick, kalite hesaplama)
- `ui/hybrid/unifiedPanel.js` — Click-to-Align entegrasyonu
- `ui/main.js` — Manyetik overlay checkbox + opaklık slider bağlantıları

---

## 0.3.7 — 31 Ağustos 2026

### 🐛 Düzeltmeler

- **TDZ Hatası Düzeltildi (kritik)** — Vite tree-shaking THREE.js objelerini yanlış chunk'a bağlıyordu (`Plane`, `Vector3` adaptiveQuality chunk'ından import ediliyordu → `Cannot access 'A' before initialization` hatası)
  - `vite.config.js`'e `manualChunks` eklendi — THREE.js kendi chunk'ında
  - `liveProbe` import'u dynamic import'a geçirildi (circular dependency önlemi)
  - Uygulama artık düzgün yükleniyor ve tüm özellikler çalışıyor

### 🔧 Teknik

- `vite.config.js` — `manualChunks: { three: ["three"], "three-addons": [...] }` eklendi
- `ui/viewer/scene.js` — `initLiveProbe` dynamic import'a geçirildi

---

## 0.3.6 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **📅 Zaman Serisi Karşılaştırma** — Aynı alanda farklı tarihlerdeki analizleri karşılaştır:
  - **Oturum Kaydetme** — Mevcut analiz sonucunu isimlendirerek kaydet (maks. 10 oturum)
  - **Karşılaştırma** — İki oturum arasındaki farkları göster:
    - 🟢 Yeni tespitler ( yeşil)
    - 🔴 Kaybolan tespitler (kırmızı)
    - ⚪ Değişmeyen tespitler
  - **Oturum Listesi** — Kayıtlı oturumları看到 ve sil
  - **Akıllı Eşleştirme** — 5 metre yakındaki yapıları "aynı" olarak eşleştir
  - **Detaylı Rapor** — Her tespit için güven yüzdesi ve tür bilgisi

### 📁 Etkilenen Dosyalar

- `ui/ui/timeSeries.js` — 🆕 Zaman serisi karşılaştırma modülü
- `ui/main.js` — Zaman serisi event listener'ları
- `index.html` — 📅 ZAMAN SERİSİ paneli (sağ panel, accordion)

---

## 0.3.5 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **↩️ Geri Al / İleri Al (Undo/Redo)** — Tek tuşla işlem geri alma:
  - Ctrl+Z ile Geri Al, Ctrl+Y ile İleri Al
  - Header'da ↩ / ↪ butonları (devre dışıysa soluk görünür)
  - Hizalama işlemleri (döndürme, ters çevirme, ölçek, kaydırma) otomatik takip edilir
  - Slider ayarları 500ms debounce ile gruplanır (çoklu undo engeli)
  - Maksimum 50 işlem geçmişi
  - Durum çubuğunda geri/ileri alınan işlemin adı gösterilir

### 📁 Etkilenen Dosyalar

- `ui/ui/undoRedo.js` — 🆕 Genel amaçlı undo/redo yığın modülü
- `ui/viewer/mapAlignment.js` — Hizalama fonksiyonlarına undo tracking eklendi
- `ui/main.js` — Ctrl+Z/Y kısayolları + buton event listener'ları
- `index.html` — ↩ / ↪ butonları eklendi

---

## 0.3.4 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **🌍 KML/Google Earth Dışa Aktarma** — Tespit sonuçlarını doğrudan Google Earth'te göster:
  - Oda/mezarlar → Yeşil daire ikonu (kapalı poligon)
  - Tüller → Turuncu kare ikonu (çizgi)
  - Metal anomalileri → Kırmızı yıldız ikonu (nokta)
  - Su tespitleri → Mavi su ikonu
  - GPS referans noktası → Hedef ikonu
  - Her placemark'a Google Maps linki dahil
  - KML formatı: Google Earth, Maps, GIS yazılımlarıyla uyumlu

### 📁 Etkilenen Dosyalar

- `ui/ui/kmlExport.js` — 🆕 KML dışa aktarma modülü
- `ui/main.js` — KML export event listener
- `index.html` — 🌍 KML butonu eklendi

---

## 0.3.3 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **🔀 Karşılaştırma Overlay Modu** — CSV ile görüntü haritasını karşılaştırma:
  - **Split** — X ekseninde split çizgisi, sol tarafta görüntü sağda CSV
  - **Bindirme** — Yarı saydam CSV noktaları görüntü üzerine bindirme
  - **Izgara** — Her iki koordinat sistemi için ızgara çizgileri
  - Opaklık slider'ı (0-100%)
  - Split çizgisi pozisyonu slider'ı (0-100%)
  - Durum göstergesi

### 📁 Etkilenen Dosyalar

- `ui/viewer/csvOverlay.js` — `applyCompareMode()` fonksiyonu (clipping plane, opacity, grid)
- `ui/main.js` — Karşılaştırma event listener'ları
- `index.html` — Split/Bindirme/Izgara butonları + slider'lar

---

## 0.3.2 — 31 Ağustos 2026

### ✨ Yeni Özellikler

- **📐 Boyut & Hizalama Paneli** — CSV haritası ile görüntü yönünü eşleştirme:
  - **↻ Döndürme** — 90°, 180°, 270° hızlı butonları + serbest açı slider'ı (0-360°)
  - **↔/↕ Ters Çevirme** — Yatay ve dikey mirror butonları
  - **Ölçek Ayarı** — X ve Z eksenlerinde bağımsız ölçek (0.1x - 5.0x)
  - **Kaydırma** — X ve Z eksenlerinde ±50m ofset
  - **Otomatik Sığdırma** — CSV sınırlarını havuz boyutuna otomatik eşle
  - **Sıfırla** — Tüm ayarları tek tuşla sıfırla
  - Durum göstergesi — Aktif transform bilgisi

### 📁 Etkilenen Dosyalar

- `ui/viewer/mapAlignment.js` — 🆕 Harita hizalama modülü (döndür, ters çevir, ölçek, kaydır)
- `ui/viewer/csvOverlay.js` — Hizalama transformu normalizasyon hattına entegre edildi
- `ui/main.js` — Hizalama kontrolleri bağlandı
- `index.html` — 📐 BOYUT & HİZALAMA paneli eklendi

---

## 0.3.1 — 31 Ağustos 2026

### 🐛 Düzeltmeler

- **CSV "Dosya Seç" butonu düzeltildi** — `bindCsvPanel()` fonksiyonu main.js'de hiç çağrılmıyordu, tıklama dinleyicisi hiç bağlanmamıştı. Eklendi.
- **Eksik bind taraması** — Tüm 35+ buton ve 14 init fonksiyonu doğrulandı, eksik kalmadı.

### 🔧 Teknik

- Build ve testler başarılı (188/188 JS test, 0 Rust hatası)
- NSIS installer: 254 MB

---

## 0.3.0 — 30 Ağustos 2026

### ✨ Yeni Özellikler

- **📄 PDF Raporunda Renk Karşılaştırması** — PDF/PNG saha raporuna "🎨 Renk Bazlı Analiz Karşılaştırması" bölümü eklendi:
  - Her renk şeması için karşılaştırma tablosu
  - Kaybolan/yeni tespitler raporda gösterilir
  - Ortalama güven değişimi raporda yer alır

### ⚡ İyileştirmeler

- **Renk-Bazlı Analiz Tekrarı** — Renk şeması değişince otomatik veya manuel analiz tekrarı
- **Otomatik Tekrar Analiz Modu** — 500ms debounce ile renk değişiminde otomatik analiz
- **Karşılaştırmalı Renk Analizi** — Her analiz sonrası tablo ile fark gösterimi
- **Renkli Yapı Tespit Gösterimi** — Her renk şeması kendi yapı renklerini getirir (oda, tünel, metal)
- **Geri Dönüşümlü Modül Yapısı** — Her özellik bağımsız açılıp kapatılabilir

### 📁 Etkilenen Dosyalar

- `ui/hybrid/colorBasedAnalysis.js` — 🆕 Renk-bazlı analiz tekrarı modülü
- `ui/hybrid/colorCompare.js` — 🆕 Karşılaştırma motoru
- `ui/viewer/structureColors.js` — 🆕 Şema bazlı yapı renk haritası
- `ui/viewer/colorizer.js` — `onPaletteChange` event sistemi
- `ui/ui/reportExport.js` — Renk karşılaştırma bölümü
- `ui/main.js` — Renk analiz kontrolleri
- `index.html` — Tekrar Analiz, Otomatik, Önbellek Temizle butonları

---

## 0.2.4 — 30 Ağustos 2026

### ✨ Yeni Özellikler

- **📍 GPS Koordinat Desteği** — WGS84 ↔ Lokal metre dönüşümü:
  - Sol menüde GPS ayarları paneli (Enlem/Boylam + lokal referans)
  - Haversine formülü ile dönüşüm
  - 3D label'da GPS koordinatı görünür
  - Sağ panel kartında GPS satırı
  - PDF raporunda GPS + Google Maps linki

### 📁 Etkilenen Dosyalar

- `ui/viewer/gpsTransform.js` — 🆕 Haversine + WGS84↔Lokal dönüşüm
- `ui/viewer/builders/metal.js` — 3D label'a GPS bilgisi
- `ui/ui/structureList.js` — Sağ panel kartına GPS satırı
- `ui/ui/reportExport.js` — PDF raporuna GPS ekle
- `index.html` — GPS ayarları paneli

---

## 0.2.5 — 30 Ağustos 2026

### ✨ Yeni Özellikler

- **🔬 Çift Analiz Tamamlayıcı Paket** — 5 bağımsız, geri dönüşümlü modül:
  - 🔄 **Geri Besleme** — Image güçlüyse CSV eşiğini düşür, CSV güçlüyse Image eşiğini düşür
  - 🟣 **Konsensüs 3D** — Doğrulanmış tespitleri mor sphere + çizgi olarak sahneye ekle
  - 📊 **Birleşik Güven** — CSV_conf × Image_conf × uyum = tek güven skoru (0-100%)
  - 📐 **Geometrik Karşılaştırma** — Boyut, derinlik, manyetik, yön farklarını hesapla
  - 🔥 **Fusion Tespiti** — Fusion haritasından yapı bul (sadece CSV'den değil)

### ⚡ İyileştirmeler

- **Geri Dönüşüm Mimarisi** — Tek tuşla tüm paket açılıp kapatılabilir
- **Modül Bazlı Kontrol** — Her modül bağımsız kontrol edilebilir

### 📁 Etkilenen Dosyalar

- `ui/hybrid/feedbackLoop.js` — 🆕 Geri besleme döngüsü
- `ui/hybrid/consensusVisuals.js` — 🆕 Konsensüs 3D görselleştirme
- `ui/hybrid/unifiedConfidence.js` — 🆕 Birleşik güven skoru
- `ui/hybrid/geometricCompare.js` — 🆕 Geometrik karşılaştırma
- `ui/hybrid/fusionDetection.js` — 🆕 Fusion-bazlı yapı tespiti
- `ui/hybrid/dualAnalysisPack.js` — 🆕 Orkestratör (5 modülü bağlar)
- `ui/hybrid/hybridEngine.js` — dualAnalysisPack entegrasyonu

---

## 0.1.80 — 28 Ağustos 2026

### ✨ Yeni Özellikler

- **🎨 Renklendirme Modu** — 8 hazır palet ile zemin dokusu renklendirmesi:
  - Manyetik Yoğunluk (mavi→yeşil→sarı→kırmızı)
  - Derinlik Haritası (sığ→derin)
  - Termal (koyu mor→sarı→beyaz)
  - Askeri (koyu yeşil→haki)
  - Okyanus (lacivert→açık mavi)
  - Gri Tonları (siyah→beyaz)
  - Metal Avcısı (koyu gri→altın→beyaz)
  - Kapalı (orijinal görünüm)
  - Modüler tasarım: `colorizer.js` silinerek tamamen kaldırılabilir

- **🌍 SDC Reader Genişletildi** — 160+ field mapping (6 dil destekli):
  - 🇬🇧 İngilizce, 🇹🇷 Türkçe, 🇩🇪 Almanca, 🇫🇷 Fransızca, 🇮🇹🇪🇸 İtalyanca/İspanyolca
  - Unicode normalizasyonu (ğ→g, ü→u, ş→s, ı→i, ö→o, ç→c)
  - Kısmi eşleştirme (parantez, boşluk, tire temizlenerek)
  - 6 yeni sensör türü: Cesium, Fluxgate, Resistivity, EM, Proton ELIC, Bartington

- **🔄 CI Pipeline** — Tek komutla test+build:
  - `npm run ci` — tüm testler + build
  - `npm run ci:fast` — sadece JS test + build
  - `npm run ci:full` — her şey (installer dahil)
  - Cross-platform: `ci.js` (Node.js), `ci.ps1` (PowerShell), `ci.sh` (Bash)

- **🤖 DTA Rehber Güncellemesi** — Derin Tarama Asistanı ekran kılavuzu yenilendi:
  - Tüm yeni özellikler (renklendirme, kesit, X-ray, kısayollar)
  - Panel düzeni ve konum haritası
  - Yorumlama kılavuzu (iyi/kötü örnekler)

### 🐛 Düzeltmeler

- **🎯 Koordinat Hizalama (kritik)** — CSV harita boyutu ile resim boyutu artık uyuşuyor:
  - `/1e7` magic number kaldırıldı → yapı tespitleri artık doğru konumda
  - `imageToCsv()` transformu eklendi
  - QualityCheck skoru auto modda 100'de sabitlendi

- **🖼️ PNG/JPEG Dışa Aktarma** — Base64 binary decode düzeltildi

- **📍 İpucu Harita Dışı Taşıma** — 7 dosyada clamp eklendi:
  - `hintEngine.js`, `tunnel.js`, `chamber.js`, `metal.js`, `shaft.js`, `water.js`
  - Normalize 0-1 aralığı dışında kalan koordinatlar artık harita sınırına kıstırılıyor

- **🎯 Kesit Düzeltildi** — Artık tüm sahneyi kesiyor:
  - Sadece zemin+grid kesilmiyor → yapılar, etiketler, grid hepsi kesiliyor
  - `structureGroup` traversal ile clip plane uygulanıyor
  - Başlangıçta boş sahne sorunu giderildi

- **📷 Kamera Senkron Kontrolü** — Kilitle/sıfırla (L kısayolu)

- **📍 İpucu Konumları** — Canvas transform + object-fit uyumsuzluğu giderildi

---

## 0.1.79 — 27 Ağustos 2026

### ✨ Yeni Özellikler

- **📷 Kamera Senkron Kontrolü** — Karşılaştırma modunda kamera kilitleme, sıfırlama ve canlı bilgi gösterimi
  - 🔒 Kamera Kilitle — Orbit/zoom/devirme hareketini dondurur (L kısayolu)
  - ↩️ Sıfırla — Kayıtlı başlangıç pozisyonuna yumuşak animasyonla döner
  - Canlı bilgi — Anlık pozisyon/zoom/kilit durumu panelde gösterilir

### 🐛 Düzeltmeler

- **SDC modülü oluşturuldu** — `sdc_reader_mod.rs` + `sdc_model.rs`: `sniffDecimalIn` (ondalık ayracı algılama), 60+ field name haritalama, çoklu sensör formatı (SGS-01, Proton, Bartington, GSSI)
- **Rust test hataları düzeltildi** — `DecisionReport`, `MetalDecision` export eklendi
- **sniffDecimal_in düzeltildi** — Token yapısına göre ondalık/binlik ayrımı
- **is_header_line düzeltildi** — Boş satır ve yorum satırları artık başlık olarak algılanmıyor

---

## 0.1.78 — 27 Ağustos 2026

### 🐛 Düzeltmeler

- **Harita karşılaştırma düzeltildi** — Clip plane artık her karede kamera matrisine göre güncelleniyor (screen-space clip plane)
- **Field name uyumsuzluğu giderildi** — Rust camelCase ve snake_case her ikisi de destekleniyor
- **Memory leak düzeltildi** — Slider event listener'ları temizleniyor
- **preRender hook sistemi eklendi** — Dairesel bağımlılık olmadan modüllerin her kare öncesi çalışmasını sağlayan mekanizma

---

## 0.1.77 — 27 Ağustos 2026

### ✨ Yeni Özellikler

- **🌙 Karanlık / ☀️ Aydınlık Tema Desteği** — Tek tıkla tema geçişi
  - Otomatik algılama — İlk yüklemede Windows tema tercihini okur
  - Kayıt — Kullanıcı tercihi localStorage'a kaydedilir
  - Canlı geçiş — Anında tema değişimi
  - Duyarlı tasarım — Tüm paneller her iki temada da okunabilir

### 🐛 Düzeltmeler

- **Rapor dışa aktarma düzeltildi** — `extractStats` içindeki özellik çakışması giderildi (`[object Object]` hatası)
- **Rapor footer sürümü güncellendi**

---

## 0.1.76 — 26 Ağustos 2026

### ✨ Yeni Özellikler

- **Harita Karşılaştırma Modu** — Yan yana ve slider ile iki harita karşılaştırma
  - Senkronize kamera kontrolü
  - Split çizgi ekranda sabit (screen-space clip)

### ⚡ İyileştirmeler

- **Marks-glow animasyonu** — CSS filter yerine opacity tabanlı hale getirildi (GPU dostu)
- **Panel optimizasyonu** — Unified panel güncellendi

---

## 0.1.75 — 26 Ağustos 2026

### ✨ Yeni Özellikler

- **📋 PDF/PNG Dışa Aktarma** — Tek tıkla profesyonel saha raporu
  - 3D sahne görüntüsü + yapı listesi + öncelik sırası + metal tespitleri
  - Tauri native save dialog ile kaydetme
- **🤖 VotexProb Faz B Entegrasyonu** — ML sonuçları rapor güvenilirlik skorlarıyla harmanlanıyor (%60 legacy + %40 VPE)
- **📍 3D Rota Planlama** — Çoklu nokta mesafe ölçümü, eğim profili, yükseklik farkı, JSON dışa aktarma
- **📊 Magnetik Anomali Rapor Kartları** — Her metal anomalisi için detaylı kart
- **🔢 Ardışık Numaralandırma** — Tespitler artık 1, 2, 3... olarak sıralanıyor
- **⛏️ Metal Analiz Fonksiyonu** — Rust backend'de `analyze_metal()` ile tam analiz raporu

### ⚡ İyileştirmeler

- **3D Sahne Performansı** — Render-on-demand döngüsü, gölge, ACES tone mapping, RoomEnvironment
- **Yatay Kesit (Clipping Plane)** — Yüksekliği ayarlanabilir kesit modu + X-Ray/Fresnel görünümü
- **Klavye Kısayolları** — X (X-Ray), K (Kesit), ↑/↓ (Kesit yüksekliği)
- **Zemin Dokusu** — Mipmap ve anizotropik filtreleme ile uzak plan titreşimi giderildi
- **Etiket Görünürlüğü** — Zemin arkasında gizleme ve mesafeye göre soluklaşma
- **FPS Tabanlı Otomatik Kalite** — Entegre GPU'larda piksel oranı ve gölge kalitesi otomatik ayar

---

## 0.1.74 — 25 Ağustos 2026

### ✨ Yeni Özellikler

- **3D Kesit Modu** — Yatay clipping plane ile yapıların iç kısımlarını görme
- **X-Ray / Fresnel Görünümü** — Yarı saydam hologram efektiyle yapıları aydınlatma
- **Klavye Kısayolları** — X, K, ↑/↓ ile hızlı kontrol
- **Zemin Derinlik Kontur Çizgileri** — Hafif shader dokunuşuyla topoğrafik detay
- **Dokümantasyon Portalı** — Broşür, teknik özet, mimari diyagram, performans raporu

### ⚡ İyileştirmeler

- **Performans Benchmark** — Boşta CPU %0, medyan 142 FPS, kesit modu %30 daha hızlı
- **Adaptif Kalite Sistemi** — FPS'e göre otomatik piksel oranı/gölge ayarı

---

## 0.1.73 — 24 Ağustos 2026

### 🐛 Düzeltmeler

- **Marks-glow animasyonu** — CSS filter yerine opacity tabanlı hale getirildi
- **Unified panel düzeltildi** — Dodan tempt sorunu giderildi

---

## 0.1.72 — 23 Ağustos 2026

### ⚡ İyileştirmeler

- **CPU Kullanım Optimizasyonu** — Vite watcher'a ağır klasörler hariç tutuldu
- **ECG Animasyon Döngüsü** — Boşta CPU tüketimi azaltıldı

---

## 0.1.71 — 22 Ağustos 2026

### ✨ Yeni Özellikler

- İlk NSIS kurulum paketi
- Temel 3D manyetik harita görüntüleme
- Oda/tünel/metal tespiti
- Analiz raporu paneli

---

## 0.1.70 — Ağustos 2026

### ✨ Yeni Özellikler

- **Zemin Dokusu İşleme** — Manyetik harita verisinden otomatik zemin dokusu oluşturma
- **3D Yapı Oluşturucu** — Oda, tünel, metal, su ve kuyu yapıları için bağımsız builder modülleri
- **Çoklu Harita Desteği** — GÖRÜNTÜ, CSV, HİBRİT ve SİSTEM modları
- **Tahmini Derinlik** — Yapılara DTAipuçları ile derinlik tahmini

### ⚡ İyileştirmeler

- **Render-on-demand** — Boşta kare çizimi durduruldu, yalnızca etkileşimde çiziliyor

---

## 0.1.60 — Ağustos 2026

### ✨ Yeni Özellikler

- **Proton ELIC Entegrasyonu** — Proton cihazı ilemanyetik tarama verisi okuma
- **DTA Köprüsü** — Derin Tarama Asistanı ile localhost üzerinden iletişim
- **Sentetik Veri Üretimi** — Demo/test amaçlı otomatik manyetik veri üretimi

### ⚡ İyileştirmeler

- **Analiz Altyapısı** — Zemin analizi, yapı tespiti, güvenilirlik hesaplama altyapısı kuruldu

---

## 0.1.50 — Temmuz 2026

### ✨ Yeni Özellikler

- **İlk Çalışan Sürüm** — Temel manyetik anomali analiz uygulaması
- **Harita Yükleme** — PNG/JPG manyetik harita görsellerini yükleme
- **Manyetik Yoğunluk Haritası** — Renk kodlu zemin dokusu oluşturma
- **Basit 3D Görüntüleme** — Three.js ile temel sahne kurulumu
- **Çekim Tipleri** — Dik çekim, yan çekim, plan haritası
- **Hedef Tipleri** — Otomatik, kuyu, oda, metal
- **Parametreler** — Min güven eşiği, derinlik aralığı, hassasiyet
- **Temel UI** — Sol kontrol paneli, orta 3D sahne, sağ analiz paneli

---

## Teknik Notlar

### Sürüm Numaralandırma
- **Birinci basamak (0)** — Major sürüm (henüz 1.0'a ulaşmadı)
- **İkinci basamak (1)** — Minor sürüm (yeni özellikler)
- **Üçüncü basamak (50-80)** — Patch sürüm (düzeltmeler ve iyileştirmeler)

### Derleme
- **NSIS Installer**: `npm run build:installer`
- **CI Pipeline**: `npm run ci` (JS test + Rust test + build)
- **Hızlı Test**: `npm run test:js`

### Platform
- **Windows x64** — NSIS kurulum paketi
- **Teknoloji** — Tauri 2.x + Rust + Three.js + Vite
