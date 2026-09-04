# VOTEX CHANGELOG

Tüm sürümlerin değişiklik kaydı.

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
