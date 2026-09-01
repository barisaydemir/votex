# VOTEX CHANGELOG

Tüm sürümlerin değişiklik kaydı.

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
