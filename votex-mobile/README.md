# Votex Mobile - Dik Çekim

Manyetik anomali analiz uygulamasının mobil versiyonu. Sadece dik çekim (vertical survey) modunu destekler.

## Özellikler

- 📁 **Harita Yükleme**: ELIC, PNG, JPEG, BMP, TIFF formatları
- 🎨 **Renk Paletleri**: 5 farklı renk şeması ile harita renklendirme
- 🔍 **Temel Analiz**: Histogram, kontrast, entropi, kenar algılama
- 💾 **Dışa Aktarma**: Renklendirilmiş haritayı PNG olarak indirme
- 📱 **Duyarlı Tasarım**: Mobil ve masaüstü uyumlu
- 🔌 **Çevrimdışı Çalışma**: Service Worker ile offline destek
- ⚡ **WASM Analiz Çekirdeği**: Rust vision.rs portunda anomali tespiti (sunucusuz)
- 📍 **GPS Konumlandırma**: Harita yüklerken konum otomatik kaydedilir
- 🤖 **AI Sunucu Desteği**: Opsiyonel — yerel AI sunucusuna bağlanabilir

## Kurulum

### 1. GitHub Pages (Yayında)

Uygulama her push'ta otomatik olarak GitHub Pages'a deploy edilir:

**URL:** `https://barisaydemir.github.io/votex/`

Telefonda kurulum:
1. URL'yi Chrome ile açın
2. Menü → **Ana Ekrana Ekle**
3. Uygulama bağımsız olarak çalışır (offline dahil)

Deploy iş akışı: `.github/workflows/deploy-pwa.yml` — `votex-mobile/` klasörü değişince otomatik tetiklenir, Actions sekmesinden manuel de çalıştırılabilir.

> **Not:** İlk deploy sonrası repo ayarlarından **Settings → Pages → Source: GitHub Actions** seçili olmalıdır.

### 2. Yerel Sunucu ile Test

```bash
# Python ile
cd votex-mobile
python -m http.server 8080

# Node.js ile
npx serve .
```

Tarayıcıda `http://localhost:8080` adresini açın.

### 3. APK'ya Dönüştürme (İsteğe Bağlı)

PWA'yi APK'ya dönüştürmek için:
- [PWABuilder](https://www.pwabuilder.com/) kullanın
- veya [Bubblewrap](https://github.com/nicedoc/bubblewrap) ile LT Web API kullanın

## Dosya Yapısı

```
votex-mobile/
├── index.html          # Ana sayfa
├── manifest.json       # PWA manifest
├── sw.js              # Service Worker
├── css/
│   └── style.css      # Mobil uyumlu stiller
├── js/
│   ├── app.js         # Ana uygulama mantığı
│   ├── colorizer.js   # 2D renklendirici
│   └── analyzer.js    # Manyetik analiz
└── icons/
    ├── icon.svg       # Vektör ikon
    ├── icon-192.png   # 192x192 ikon
    └── icon-512.png   # 512x512 ikon
```

## Kullanım

1. **Harita Yükleme**
   - "Dosya Seç" butonuna tıklayın veya dosyayı sürükle-bırak yapın
   - ELIC veya standart resim formatlarını destekler

2. **Renklendirme**
   - Üst kısımdaki renk paletlerinden birini seçin
   - Opacity slider'ı ile saydamlığı ayarlayın
   - ↩ butonu ile geri alın

3. **Analiz**
   - "Analiz Et" butonuna tıklayın
   - Sonuçlar aşağıda gösterilir:
     - Boyut ve piksel sayısı
     - Ortalama ve standart sapma
     - Kontrast ve dinamik aralık
     - Kenant (gradyan) değeri
     - Entropi (bilgi içeriği)

4. **Dışa Aktarma**
   - 💾 butonu ile renklendirilmiş haritayı PNG olarak indirin

## Teknik Detaylar

### Renk Paletleri

- **Manyetik Yoğunluk**: Mor tonları (yoğunluk gösterimi)
- **Sıcak Noktalar**: Mavi-beyaz (sıcak bölgeler)
- **Toprak Profili**: Kahverengi tonları (toprak katmanları)
- **Yeraltı Yapısı**: Yeşil tonları (yapısal özellikler)
- **Su Kaynakları**: Mavi tonları (su unsurları)

### Analiz Metrikleri

- **Ortalama**: Piksel yoğunluk ortalaması (0-255)
- **Standart Sapma**: Dağılım genişliği
- **Kontrast**: Maksimum-minimum fark
- **Dinamik Aralık**: Yüzdelik kontrast
- **Kenant**: Kenar algılama şiddeti
- **Entropi**: Bilgi içeriği (bit)

## Sorun Giderme

### Dosya Yüklenemiyor

- Dosya formatı destekleniyor mu? (ELIC, PNG, JPEG, BMP, TIFF)
- Dosya boyutu çok mu büyük? (Tarayıcıya bağlı, genellikle 50MB limit)

### Renkler Gösterilmiyor

- Sayfayı yenileyin
 tarayıcı önbelleğini temizleyin

### Çevrimdışı Çalışmıyor

- Service Worker'ın yüklendiğinden emin olun (Tarayıcı geliştirici araçları > Uygulama > Service Workers)

## Lisans

Digital Future Tech © 2026