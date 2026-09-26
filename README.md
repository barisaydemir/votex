# Votex — Magnetic Anomaly Analysis

Votex, manyetik anomali haritalarını görselleştiren, maskeleyen ve yorumlayan bir masaüstü analiz uygulamasıdır: Tauri 2 + Rust çekirdeği, Three.js tabanlı 3D sahnesi ve opsiyonel **DTA (Derin Tarama Asistan)** sesli asistan entegrasyonuyla saha verisini karar destekte kullanılabilir hale getirir.

## 📄 Broşür

Ürünün yeteneklerine, sensör teorisine ve mimari yaklaşımına dair üç sayfalık teknik özeti buradan inceleyebilirsiniz:

**[votex.pdf](votex.pdf)** — Manyetik Sensör Teorisi ve Kutuplardan Hasasiyete: renk bantlı harita okuma, OpenCV tabanlı kontur/alan analizi, Rust hızlandırmalı görüntü işleme ve VOTEX–DTA entegrasyonuna genel bakış.

## Öne çıkanlar

- **3D jeofizik görselleştirme** — Three.js sahnesinde yüzey tabanlı anomali maskeleme, hedef birleştirme ve adım/zincir analizi (`chainCues`, spatial hash hızlandırmalı)
- **Legacy DIK görüntüleyici** — arşiv uyumluluğu korunarak birleştirilmiş hedef modeli, ölçülen footprint'ler ve görünürlük denetleyicisi
- **DTA sesli asistan köprüsü** — VOTEX panelinden yazılan sorular DTA'ya (Python/Gemini Live) iletilir; yanıtlar panelde akar, panel istekle DTA penceresini tray'e alıp geri getirebilir
- **Vaka kalıcılığı** — sohbet geçmişi ve analiz oturumu vaka arşivine yazılır, açılışta geri yüklenir
- **Tek komutla sürüm** — `npm run release` senkronize sürüm artışı + testler + Windows kurulum paketleri üretir

## Kurulum (son kullanıcı)

`KURULUM_PAKETLERI/` altındaki birleşik kurulumu kullanın:

- `Votex_<sürüm>_Kurulum.exe` — VOTEX + DTA + runtime'lar (önerilen)
- `VotexArtemis_<sürüm>_Kurulum.exe` — yalnız VOTEX (DTA'sız, ~58 MB)

Kurulum `{autopf}` altına yerleşir; DTA yapılandırma, log ve raporlar `%APPDATA%\DFT\DerinTaramaAsistan` ağacında tutulur (Program Files yazma gerektirmez).

## Geliştirici

```bash
npm install            # bağımlılıklar
npm run dev            # Vite geliştirme sunucusu (Tauri ile)
npm run test:js        # vitest (600+ test)
npm run check:rust     # cargo check
npm run test:rust      # cargo test --lib
npm run release        # sürüm artışı + testler + NSIS + birleşik setup
```

### Depo düzeni

| Yol | İçerik |
| --- | --- |
| `ui/` | Ön yüz: vanilla JS + Three.js sahne, paneller, Tauri API sarmalayıcıları |
| `src-tauri/` | Rust çekirdek: köprü sunucusu (127.0.0.1:18765), komutlar, ayarlar |
| `Derin_Tarama_Asistan/` | DTA sesli asistan (Python/Tk) — ayrı paketlenir |
| `modules/dft_packager/` | Inno Setup + NSIS paketleme betikleri |
| `scripts/` | `release.mjs`, UI sağlık denetimi, CI yardımcıları |

### Sürümleme kuralı

Sürüm `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`, `modules/dft_packager/DFT_Suite.iss`, `VotexArtemis.iss`, `build_single_setup.py` ve `CHANGELOG.md` arasında senkron tutulur; her işlem sonrası `npm run release` ile yeni kurulum paketleri üretilir. Ayrıntılar için [AGENTS.md](AGENTS.md).
