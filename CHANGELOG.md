# VOTEX CHANGELOG

Tüm sürümlerin değişiklik kaydı.

---

## 0.4.21 — 7 Eylül 2026

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
