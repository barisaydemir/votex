# Votex 0.1.74 — Teknik Özellik Özeti

**Ürün:** VOTEX — Tactical Geophysics Command Center  
**Sürüm:** 0.1.74  
**Geliştirici:** Digital Future Tech (Barış Aydemir)  
**Platform:** Windows (x64) — Tauri 2 + WebView2  
**Derleme:** NSIS kurulum paketi (~220 MB)

---

## 1. Genel Mimari

```
┌─────────────────────────────────────────────────────────┐
│                    VOTEX MİMARİSİ                        │
├─────────────────┬───────────────────────────────────────┤
│  Rust Backend   │  JavaScript Frontend (ES Modules)     │
│  (Tauri 2)      │  Three.js 0.185 · Vite 6             │
├─────────────────┼───────────────────────────────────────┤
│ • Komutlar      │ • 3D Görüntüleyici (WebGL2)          │
│ • Manyetik analiz│ • Hibrit analiz motoru                │
│ • Yapı tespiti   │ • CSV / Görsel işleme                │
│ • DTA köprüsü   │ • UI panelleri / durum                │
│ • Oturum kayıt  │ • Telemetri / loglama                  │
│ • Lisans/güncelleme│ • Klavye kısayolları               │
└─────────────────┴───────────────────────────────────────┘
         ↑ Tauri IPC (invoke/emit) ↑
```

---

## 2. Rust Backend Modülleri (`src-tauri/src/`)

### 2.1 Manyetik Analiz (`magnetic/`)
- **Anomali sınıflandırma:** Neutral / PositiveMetal / NegativeVoid
- **Kalibrasyon modları:** Median, Mean, Sabit (kullanıcı tanımlı nT)
- **Palet:** Proton ELIC uyumlu bipolar renk haritası (yeşil→sarı→turuncu→kırmızı pozitif; yeşil→açık mavi→koyu mavi negatif)
- **Histogram-eşitleme:** Renk dağılımını veriye otomatik uyarlayan normalizasyon
- **Eşik parametreleri:** neutral_tolerance, hysteresis_deadband, moving_average_window

### 2.2 Yapı Tespiti (`structures/`)
- **Blob tespiti:** Manyetik imzalardan-manyetik olmayan bölgeleri ayıran+%blob outlining (PCA ekseni, doluluk oranı, dış kontur)
- **Sınıflandırma (`classify.rs`):** Room / Tomb / Shaft / Tunnel / Noise — `VoidClass` enum'u ile
- **Geom analiz (`analysis/`):**
  - `symmetry.rs`: Simetri endeksi, simetri ekseni, dikdörtgensellik, uzama oranı, ayna kalıntı skoru
  - `fit.rs`: Ölçü uyum skoru, yön uyum skoru, fit_adjusted bayrağı
- **Derinlik kestirimi:** Fiziksel 1/r^n genlik-derinlik ilişkisi, çoklu kademe (tier 0–3)
- **Yapı türleri:**
  - **Chamber (Oda/Mezar/Shaft):** cx, cy, rx, ry, derinlik, yükseklik, genişlik×uzunluk, kanıt vektörü (SNR, duvar desteği, yollar)
  - **Tunnel (Tünel):** x0,y0→x1,y1, radyus, yön, pusula, taban/tavan kot farkı
  - **MetalBody (Metal Anomali):** alan gücü,ierochk猜測 (au_ag_fe/iron), cue türü, plume yüksekliği,oda içi/bağımsız
  - **WaterBody:** Su olasılığı overlay'i (negatif bant yoğundluğu)

### 2.3 Analiz Raporu (`structures/analysis_report.rs`)
- **Güvenilirlik sınıflandırması:** high (≥%70, SNR≥1.5, net duvar) / medium / low / rejected
- **Kurallı rapor üretimi:** Her tespit için detay, uyarı, öneri — AI gerekmez
- **Öncelik sıralaması:** Yüksek güvenilirlik → Orta → Düşük; ardışık numaralandırma (1, 2, 3...)
- **Metal anomalileri raporu:** field_strength ≥ 0.55 + değerli metal/güçlü cue → öncelikli; ≥ 0.3 → ikinci sıra
- **Çevresel analiz:** Yakındaki metaller, benzer yapılar, kurtarma kapısı uyarısı

### 2.4 İpucu Sistemi (`structures/hints.rs`)
- **StructureHint:** DTA'dan gelen yapı yönlendirmeleri (room/tomb/tunnel/metal/shaft)
- **apply_structure_hints():** Mevcut yapıları güçlendirme veya yeni yapı enjekte etme
- **structures_to_hints():** Tespit edilen yapıları StructureHint listesine çevirme

### 2.5 Zemin Profili (`soil_profile.rs`)
- **6 toprak profili:** off (kapalı), sand (kum), loam (tın/nötr), clay (kil), laterite (demirli), organic (humus)
- **Derinlik çarpanı:** Her toprağın manyetik yayılıma etkisi (0.70–1.10)

### 2.6 Yüzey Modelleri (`surface/models.rs`)
- **Surface3D:** Grid boyutu, yükseklik dizisi, renk dizisi, kaynak ölçüleri, toprak profili
- **UndergroundStructures:** chambers[], tunnels[], metals[], waters[] + geometri raporu
- **GeometryAnalysis:** Simetri, dikdörtgensellik, uzama, fit düzeltmeleri
- **SiteGeometryReport:** Saha geneli istatistikler + VotexProb durumu

### 2.7 Veri Girdileri
- **Görsel analiz (`image_cmds`):** Proton ELIC ekran görüntüsü → manyetik grid → yapı tespiti → 3D yüzey
- **CSV analiz (`csv_cmds`):** Sayısal sensör verisi → banyak noktalı harita → yapı tespiti
- **Excel desteği:** calamine kütüphanesi ile .xlsx/.xls okuma
- **Ham manyetik (`magnetic_cmds`):** nT değerleri → renk haritası + yapı tespiti
- **Ekran yakalama (`capture_cmds`):** XCAP ile sensör ekran görüntüsü yakalama (tek kare)

### 2.8 DTA Köprüsü (`dta_bridge.rs`)
- **TCP köprüsü:** `127.0.0.1:18765` — DTA (harici analiz aracı) ile iletişim
- **POST /guide:** Yapı ipuçları enjekte etme, 3D'yi yeniden oluşturma
- **GET /status:** İpucu sayısı, oturum durumu
- **Otomatik başlatma:** Votex açılışında DTA process'i otomatik başlar

### 2.9 VotexProb İstemcisi (`prob_client/`)
- **TCP istemcisi:** `127.0.0.1:18766` — Python hesap motoru ile iletişim
- **Faz A:** health / policy / decide stub'ları
- **Negatif önbellek:** Motor kapalıyken 1.2 sn boyunca tekrar sorgulamaz
- **Otomatik başlatma:** VotexProb.exe otomatik başlatılır

### 2.10 Diğer Backend Modülleri
- **session_persist.rs:** Son oturum + DTA ipuçları + yüzey verisi `%APPDATA%\Votex\last_work.json`'a kalıcı kaydedilir
- **hint_store.rs:** Harita bazlı ipucu saklama (SHA256 parmak izi, maks. 40 harita, JSON dosyası)
- **app_settings.rs:** Uygulama ayarları (toprak profili, DTA yolu, oto başlatma tercihleri)
- **license.rs:** HWID tabanlı lisans doğrulama (HMAC-SHA256)
- **updater.rs:** Versiyon kontrolü, paket uygulama
- **archive.rs:** Harita arşivleme/yükelleme/silme (APPDATA klasörü)
- **preprocess.rs:** Görüntü ön işleme (kırpma, duvar ipuçları, temizleme)
- **capture.rs:** Ekran yakalama altyapısı (XCAP kütüphanesi)
- **vision.rs:** Görüntü yorumlama (DTA ekran okuma)

---

## 3. JavaScript Frontend Modülleri (`ui/`)

### 3.1 3D Görüntüleyici (`ui/viewer/`)

#### 3.1.1 Sahne Yönetimi (`scene.js`)
- **Render-on-demand:** `invalidate()` → `requestAnimationFrame` döngüsü; boştayken GPU tamamen sessiz
- **ACES Filmik ton haritalama:** Sinematik renkAspectRatio
- **RoomEnvironment:** Sıfır asset ile PBR ortam yansıması
- **Gölge sistemi:** PCFSoftShadowMap, 2048×2048 başlangıç, otomatik kamera-fit
- **Sis:** Uzak yapıları yumuşakça gizleyen lineer sis
- **Kesit düzlemi:** Yatay clipping plane — zemin "soyulur", yapılar korunur
- **FPS otomatik kademe:** 4 kademe (Tam→Dengeli→Performans→Uyumluluk)

#### 3.1.2 Zemin (`ground.js`)
- **Colormap DataTexture:** Manyetik renk haritasını XZ düzlemine serer
- **Önizleme dokusu:** Temizlenmiş görüntü (base64 img) ile yüksek çözünürlük
- **Mipmap + Anizotropik filtreleme:** Uzak plan titreşimi giderilir (8× anizotropy)
- **Reliefharitası:** Manyetik imzadan yeraltı yükseklik alanı (burialReliefY)
- **Kontur çizgileri:** `onBeforeCompile` ile enjekte edilen fwidth tabanlı derinlik eğrileri (otomatik aralık seçimi)
- **Kot yamaları:** Yapı başına yerel yüzey yükseklik düzeltmesi (disk/segment Gaussianağı)
- **Arazi örnekleyici:** `sampleTerrainY()` — bilineer interpolasyonla dünya koordinatından arazi yüzey Y'si

#### 3.1.3 Yapı Builder'ları (`builders/`)
- **chamber.js:** Oda/Mezar/Shaft — kutu veya dış konturlu 3D mesh, rozet + detay etiketi
- **tunnel.js:** Tünel — silindir/İ-kesit, yön pusulası, D-kemer şablonu
- **metal.js:** Metal anomali — küre, halo halkası, plume sütunu
- **water.js:** Su olasılığı — şeffaf mavi bant overlay
- **freeDraw.js:** Serbest çizim katmanı — çoklu bant, via noktaları

#### 3.1.4 Etiketler (`labels.js`)
- **Rozet sprite'ları:** Numaralı balon haritası pinleri (CanvasTexture, tonedMapped=false)
- **Detay etiketleri:** Başlık + 2 satır bilgi kartları
- **Kamera uçuşu:** `flyCameraTo()` — eased cubic animasyonla yapıya odaklanma
- **Seçim halkası:** Altın renkli RingGeometry gösterge

#### 3.1.5 Etiket Solması (`labelFade.js`)
- **Arazi gizlemesi:** Kamera→etiket doğrusu 12 noktada örneklenir; arazi altında ise opaklık %12'ye düşer
- **Mesafe solması:** 40 m'den itibaren solar, 110 m'de %15 tabana iner
- **Önbellekli sprite listesi:** O(N) traverse yerine sabit liste, yapı değiştiğinde sıfırlanır

#### 3.1.6 X-Ray / Fresnel (`xray.js`)
- **Fresnel shader:** Kameraya bakış açısına göre kenar parlaması, yarı saydam hologram
- **Paylaşılan malzeme önbelleği:** Renk+opaklık başına tek ShaderMaterial
- **clearStructures uyumlu:** Paylaşılan malzemeler dispose edilmez

#### 3.1.7 Performans Kalitesi (`adaptiveQuality.js`)
- **4 kademe:** Tam (2.0 DPR, 2048 gölge) → Uyumluluk (1.0 DPR, gölge yok)
- **FPS ölçümü:** Yalnızca ardışık karelerde (boşta sıfır ölçüm)
- **Sallanma önleme:** Düşürme 2.5 sn soğuma, yükseltme 12 sn kararlılık
- **Otomatik uygulama:** Piksel oranı + gölge çözünürlüğü kademe ile değişir

#### 3.1.8 Klavye Kısayolları (`ui/viewerKeys.js`)
- **K** → Kesit modu aç/kapa
- **X** → X-Ray görünümü aç/kapa
- **↑/↓** → Kesit yüksekliği ±1 m
- Form elemanı odaklanınca devre dışı

#### 3.1.9 Yapı Seçimi (`pick.js`)
- Tıklama ile yapı seçimi, detay etiketini gösterme, kamera uçuşu
- Seçim halkası gösterimi

#### 3.1.10 Koordinat Dönüştürme (`coords.js`)
- Normalize (0–1) harita → dünya (metre) dönüşümü
- `mapToWorld()`, `worldToMap()`, `depthRangeOf()`

#### 3.1.11 CSV Analiz Overlay (`csvAnalysis.js`)
- CSV noktalarını 3D sahneye nokta bulutu olarak bindirme
- Renk kodlaması: manyetik değere göre

### 3.2 Hibrit Analiz Motoru (`ui/hybrid/`)

#### 3.2.1 Tek Motorlu Hibrit (`hybridEngine.js`)
5 adımlı tek iş akışı:
1. **Hizalama** (`coordinateAlignment.js`): Image ve CSV koordinat hizalama (auto/manuel)
2. **Birleştirme** (`dataFusion.js`): Ağırlıklı ortalama (CSV %70 / Image %30), k-NN komşu arama, güven skoru
3. **Derinlik** (`depthAnalysis.js`): Gradyan tabanlı derinlik kestirimi + 3B potansiyel alanı inversiyonu
4. **Çapraz doğrulama** (`crossValidation.js`): Image ve CSV tespitlerini karşılıklı doğrulama
5. **İpuçları** (`hybridHints.js`): Uyumlu/uyumsuz tespitlerden yapı yönlendirmeleri üretme

**Özellikler:**
- Parametre hash ile aynı analizi tekrar çalıştırmayı engelleme
- Debounce ile çok sık tetikleme engelleme
- İptal token'ı ile çalışma iptali
- Sonuçları UI paneline aktarma (canvas + istatistik + rapor)

#### 3.2.2 Görüntü İşleme (`imageProcessor.js`)
- Renk → nT dönüşüm LUT'u (Proton ELIC ekran skalası)
- Grid çıkarma (konvolüsyon, gürültü azaltma)
- Düşük_sinyal maskesi

#### 3.2.3 Veri Füzyonu (`dataFusion.js`)
- **Ağırlıklı ortalama:** CSV ağırlığı ayarlanabilir (%0–100)
- **Güven skoru:** Excellent (≥85%) / Good / Fair / Poor — iki kaynak uyumuna göre
- **nT haritası render:** Renkli canvas + güven opaklığı
- **Karşılaştırma haritası:** Uyumlu/uyumsuz hücreler

### 3.3 UI Panelleri (`ui/ui/`)

#### 3.3.1 Analiz Paneli (`analysisPanel.js`)
- **Yapı kartları:** Her tespit için güven, boyut, derinlik, SNR, duvar desteği
- **Öncelik sırası:** 1'den başlayarak ardışık numaralandırma
- **Metal tespitleri:** Değerli metal (Au/Ag/Fe) vurgusu, oda içi/bağımsız ayrımı
- **Uyarı/seçenek rozetleri:** Kurtarma kapısı, güvenilirlik, kazı önerisi

#### 3.3.2 Durum Panelleri
- **DTA link durumu** (`dtaLink.js`): 4 sn aralıkla TCP kontrolü, `document.hidden` koruması
- **VotexProb durumu** (`probEngine.js`): 5 sn aralıkla health sorgusu, negatif önbellek
- **Lisans rozeti** (`licenseBadge.js`): 60 sn aralıkla HWID lisans doğrulama
- **Güncelleme** (`updater.js`): 45 sn aralıkla versiyon kontrolü

#### 3.3.3 EKG Monitörü (`heartbeat.js`)
- Canvas tabanlı mini ECG çizgisi
- ~25 fps'e kısılmış animasyon (60 fps sonsuz döngü değildi)
- `document.hidden` iken çizim tamamen durur
- Busy durumunda nabız artışı

#### 3.3.4 Tarama Efektleri (`scanFx.js`)
- 2D laser sweep animasyonu (analiz sırasında)
- Marks pulse glow (analiz sonrası)
- Structure card pulse-in animasyonu

#### 3.3.5 Aşama Göstergesi (`stageHud.js`)
- 3D sahne üzerinde HUD overlay
- Kamera açısı, zoom seviyesi, yapı sayısı

### 3.4 Uygulama Altyapısı (`ui/app/`)
- **state.js:** Merkezi durum yönetimi (Three.js nesneleri, kontroller, ayarlar)
- **status.js:** Durum çubuğu mesajları

### 3.5 G/Ç Modülleri (`ui/io/`)
- CSV dosyası yükleme/çeşitleme
- DTA veri aktarımı

### 3.6Uluslararası Dil (`ui/i18n/`)
- **labels.js:** TR/EN etiket mappings (yapı türleri, metal türleri, toprak profilleri)
- `isValuableMetal()` — Au/Ag/Fe kontrolü

---

## 4. Temel Akışlar

### 4.1 Görüntü → 3D Analiz Akışı
```
Proton ELIC ekran görüntüsü → pick_image_file (Tauri dialog)
  → analyze_uploaded_image (Rust: renk temizleme, LUT çıkarma)
    → build_surface_3d (Rust: yapı tespiti + derinlik kestirimi)
      → dta-guide eventi → frontend: buildMesh()
        → 3D sahne oluşturuldu
```

### 4.2 CSV → 3D Analiz Akışı
```
CSV/Excel dosyası → pick_csv_file (Tauri dialog)
  → parse_excel_data / analyze_csv_data (Rust: veri parse)
    → build_surface_from_csv (Rust: yapı tespiti)
      → surface3d eventi → frontend: buildMesh()
```

### 4.3 Hibrit (Image + CSV) Akışı
```
Image grid + CSV noktaları → runHybridAnalysis (JS)
  1. CoordinateAligner.autoAlign()
  2. fuseDataSources() — ağırlıklı füzyon
  3. analyzeDepth() — gradyan tabanlı derinlik
  4. crossValidate() — çapraz doğrulama
  5. generateHints() — yapı yönlendirmeleri
    → 3D sahne + ipuçları
```

### 4.4 DTA Yönlendirme Akışı
```
DTA uygulaması → POST /guide (TCP 18765)
  → apply_guide() (Rust: ipuçları kaydet + yeniden hesapla)
    → dta-guide eventi → frontend: rebuildSurface()
      → 3D sahne DTA ipuçlarıyla güncellendi
```

---

## 5. Performans Optimizasyonları (v0.1.74)

| Sorun | Çözüm | Etki |
|-------|-------|------|
| Dev sunucusu ~%170 CPU (Vite watcher) | `target/dist/logs` hariç tutma | ✅ Kalıcı |
| EKG 60 fps sonsuz döngü | ~25 fps + hidden durdur | ✅ ~%60 CPU tasarrufu |
| `marks-glow` filter animasyonu | Opacity tabanlı statik filtre | ✅ GPU rasterleştirme yok |
| Panel interval'ları görünmeyende çalışır | `offsetParent === null` koruması | ✅ DOM yazma yok |
| DTA/Prob IPC gizliyken çalışır | `document.hidden` koruması | ✅ Rust uyanmaz |
| Kesit slider her harekette shader yeniden derleme | `_lastClipConstant` önbelleği | ✅ 1× derleme, geri bedava |
| LabelFade her karede O(N) traverse | Sprite listesi önbelleği | ✅ Sabit liste |
| tick() draw=false iken bile devam | draw=false → rafId=null | ✅ Gazebo harcaması yok |
| meterGrid her rebuild'de yeniden oluşturma | getObjectByName ile koruma | ✅ Buffer tekrar kullanımı |
| DataTexture.image.addEventListener hatası | addEventListener varsa yükle | ✅ Çökme düzeltildi |

---

## 6. 3D Görüntüleyici Özellikleri

### Render
- **Motor:** Three.js r185, WebGL2, render-on-demand
- **Ton haritalama:** ACES Filmic (exposure 1.06)
- **Ortam:** RoomEnvironment PMREM (environmentIntensity 0.35)
- **Gölge:** PCFSoftShadowMap, harita boyutuna otomatik sığdırma
- **Sis:** Lineer, 45–160 m aralığı
- **Kesit:** Yatay clipping plane, ayarlanabilir yükseklik

### Etkileşim
- **OrbitControls:** Sürükleme, zoom, döndürme + sönümleme
- **Yapı seçimi:** Tıklama ile odaklanma, kamera uçuşu
- **Kısayollar:** K (kesit), X (x-ray), ↑/↓ (yükseklik)
- **Ölçü aracı:** Mesafe ölçümü (çift tıklama ile)

### Görsel Katmanlar
- **Zemin:** Manyetik colormap + relief + kontur çizgileri + mipmap/anizotropi
- **Yapılar:** Oda (kutu), Tünel (silindir/İ-kesit), Metal (küre+halo), Su (şeffaf bant)
- **Etiketler:** Rozet (map pin) + detay kartları + solma
- **Tel kafes:** Wireframe modu
- **X-Ray:** Fresnel hologram görünümü
- **Serbest çizim:** Kullanıcı tanımlı bantlar ve via noktaları

---

## 7. Performans Kademe Sistemi

| Kademe | Ad | Piksel Oranı | Gölge | Kullanım |
|--------|----|-------------|-------|----------|
| 0 | Tam | 2.0 | 2048×2048 | Güçlü GPU, masaüstü |
| 1 | Dengeli | 1.5 | 1024×1024 | Orta GPU |
| 2 | Performans | 1.2 | 1024×1024 | Entegre GPU |
| 3 | Uyumluluk | 1.0 | Kapalı | Zayıf GPU, laptop |

**Mantık:**
- FPS < 38 → kademe düşür (2.5 sn soğuma)
- FPS > 57 → kademe yükselt (12 sn kararlılık)
- Boşta (kamera hareket yok) → ölçüme son ver, maliyet sıfır

---

## 8. Klavye Kısayolları

| Tuş | İşlev |
|-----|-------|
| **K** | Kesit (clipping) modu aç/kapa |
| **X** | X-Ray / fresnel görünümü aç/kapa |
| **↑** | Kesit yüksekliği +1 m |
| **↓** | Kesit yüksekliği −1 m |
| **Escape** | Ölçü aracını iptal et |

*Not: Odak bir form elemanındayken (input/select/textarea) kısayollar devre dışıdır.*

---

## 9. Dış Sistem Entegrasyonları

### 9.1 DTA (Harici Analiz Aracı)
- **Protokol:** TCP HTTP/1.1, `127.0.0.1:18765`
- **Yönlendirmeler:** POST /guide ile yapı ipuçları enjekte etme
- **Oturum:** Son 3D + ipuçları otomatik kaydedilir
- **Başlatma:** Votex açılışında otomatik başlatılır

### 9.2 VotexProb (Hesap Motoru)
- **Protokol:** TCP HTTP/1.1, `127.0.0.1:18766`
- **Durum:** Health/policy/decide endpoint'leri (Faz A: stub)
- **Başlatma:** VotexProb.exe otomatik başlatılır

---

## 10. Veri Saklama

| Veri | Konum |
|------|-------|
| Son oturum | `%APPDATA%\Votex\last_work.json` |
| Harita ipuçları | `%APPDATA%\Votex\map_hints.json` |
| Harita arşivleri | `%APPDATA%\Votex\*` (klasör isimleri) |
| Uygulama ayarları | `%APPDATA%\Votex\settings.json` |
| Lisans | `%APPDATA%\Votex\license.dat` |

---

## 11. Test Altyapısı

- **Çalıştırıcı:** Vitest 4.1.11
- **Test sayısı:** 188 (JS tarafı)
- **Kapsam:** adaptiveQuality karar mantığı, analiz raporu güvenilirliği, yapı hint dönüşümleri, veri füzyonu, derinlik analizi, çapraz doğrulama,.coordinate alignment
- **Rust tarafı:** `#[cfg(test)]` modülleri (cargo test)

---

## 12. Derleme ve Paketleme

```bash
# Geliştirme
npm run dev          # Vite dev sunucusu (port 1420)

# Üretim derlemesi
npm run build        # Vite production build → dist/
npm run test:js      # Vitest testleri

# Tauri kurulum paketi
npm run build:installer   # tauri build --bundles nsis
# Çıktı: target/release/bundle/nsis/Votex_0.1.74_x64-setup.exe
```

**Bağımlılıklar:**
- **Frontend:** Three.js r185, @tauri-apps/api v2, Vite 6
- **Backend:** tauri v2, serde, base64, image, xcap, rfd, hmac, sha2, calamine

---

*Bu doküman Votex 0.1.74 sürümü itibarıyla hazırlanmıştır. Sürüm yükseltmelerinde güncellenmelidir.*
