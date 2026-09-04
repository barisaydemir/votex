# Votex Android — Bağımsız APK

Votex PWA'sını Android APK'ya dönüştürür. Bilgisayara ihtiyaç duymadan çalışır.

## Gereksinimler

- [Android Studio](https://developer.android.com/studio) (2022 veya sonrası)
- JDK 17+
- Android SDK 34

## Kurulum

### 1. Android Studio'u Açın

`votex-android` klasörünü Android Studio ile açın:
- **File → Open** → `votex-android` klasörünü seçin
- Gradle sync'i bekleyin

### 2. PWA Dosyalarını Kopyalayın

Build'ten önce PWA dosyalarını assets klasörüne kopyalayın:

**Windows:**
```cmd
copy-assets.bat
```

**Linux/Mac:**
```bash
chmod +x copy-assets.sh
./copy-assets.sh
```

### 3. APK Build Edin

**Debug APK (test için):**
```
Android Studio → Build → Build Bundle(s) / APK(s) → Build APK(s)
```

**Release APK (dağıtım için):**
```
Android Studio → Build → Generate Signed Bundle / APK
```

### 4. APK'yı Telefona Kurun

1. USB hata ayıklamayı açın (Ayarlar → Geliştirici Seçenekleri)
2. Telefona bağlayın
3. APK'yı yükleyin

veya

1. APK'yı telefona aktarın (USB, Bluetooth, e-posta)
2. Dosya yöneticisinden açın
3. "Bilinmeyen kaynaklardan yükleme" izni verin

## Proje Yapısı

```
votex-android/
├── app/
│   ├── src/main/
│   │   ├── java/com/votex/mobile/
│   │   │   └── MainActivity.java      # WebView + GPS köprüsü
│   │   ├── assets/                     # PWA dosyaları (build önce kopyalanır)
│   │   │   ├── index.html
│   │   │   ├── css/style.css
│   │   │   ├── js/*.js
│   │   │   └── icons/
│   │   ├── res/
│   │   │   ├── layout/activity_main.xml
│   │   │   ├── values/strings.xml
│   │   │   ├── values/colors.xml
│   │   │   └── values/themes.xml
│   │   └── AndroidManifest.xml
│   └── build.gradle
├── build.gradle
├── settings.gradle
├── copy-assets.bat                    # Windows için kopyalama scripti
└── copy-assets.sh                     # Linux/Mac için kopyalama scripti
```

## Özellikler

### Dahili Özellikler
- ✅ Tamamen bağımsız (sunucu gerekmez)
- ✅ Çevrimdışı çalışma (Service Worker)
- ✅ GPS konumlandırma (native bridge)
- ✅ Harita yükleme ve renklendirme
- ✅ Temel analiz (istemci tarafı)
- ✅ PNG dışa aktarma

### AI Sunucusu (İsteğe Bağlı)
Eğer AI sunucunuz çalışıyorsa (aynı WiFi ağındaysa):
1. AI panelinde sunucu URL'sini girin (örn: `http://192.168.1.100:8080`)
2. "Bağlan" butonuna tıklayın
3. Model seçin ve analiz çalıştırın

**Not:** AI sunucusu bilgisayarda çalışır. Telefondan erişim için aynı WiFi ağı gereklidir.

## GPS Kullanımı

Uygulama ilk açıldığında GPS izni ister:
1. "Konum izni ver" butonuna tıklayın
2. GPS koordinatları otomatik kaydedilir
3. Her harita yüklemede konum bilgisi saklanır

## Sürüm Güncelleme

1. `app/build.gradle` içinde `versionCode` ve `versionName` güncelleyin
2. APK'yı yeniden build edin
3. Eski APK'yı kaldırıp yenisini kurun

## Sorun Giderme

### Gradle Sync Hatası
- Android Studio'u güncelleyin
- `File → Invalidate Caches / Restart`

### GPS Çalışmıyor
- İzinlerin verildiğinden emin olun
- Test cihazında GPS'in açık olduğundan emin olun

### APK Yüklenemiyor
- "Bilinmeyen kaynaklardan yükleme" iznini açın
- Depolama iznini kontrol edin

## Lisans

Digital Future Tech © 2026