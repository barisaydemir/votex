# VOTEX CHANGELOG

Tüm sürümlerin değişiklik kaydı.

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
