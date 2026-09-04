# votex-wasm

Votex manyetik analiz çekirdeğinin WebAssembly derlemi. Telefon tarayıcısında,
sunucu olmadan çalışır.

## Kaynak

`src-tauri/src/vision.rs` (masaüstü Tauri backend) portudur:
- HSV renk uzayı dönüşümü
- Sol dikey şeritten LUT eşleştirme
- Pozitif/negatif bağlı bileşen anomalisi tespiti
- Histogram istatistikleri

## Build

```bash
# wasm-pack kur (bir kez)
cargo install wasm-pack

# Build (bundler target — votex-mobile için)
cd votex-wasm
wasm-pack build --target web --out-dir ../votex-mobile/wasm --out-name votex_wasm
```

Çıktı: `votex-mobile/wasm/` klasörü
- `votex_wasm_bg.wasm` — WASM binary (~30-50 KB)
- `votex_wasm.js` — JS glue kodu

## Kullanım (JS)

```js
import init, { analyze_colormap, image_stats } from './wasm/votex_wasm.js';

await init(); // WASM yükle

const result = analyze_colormap(
  imageData.data,  // RGBA Uint8Array
  imageData.width,
  imageData.height,
  24,              // LUT şerit genişliği
  80,              // min blob alanı
  0.35             // eşik
);

const parsed = JSON.parse(result.json());
// { width, height, anomalies: [{class, cx, cy, area, intensity, x, y, w, h}] }
```

## API

| Fonksiyon | Açıklama |
|-----------|----------|
| `analyze_colormap(rgba, w, h, strip, min_area, threshold)` | Kolormap anomali tespiti |
| `image_stats(rgba)` | Histogram istatistikleri (mean, stdDev, entropy) |
| `version()` | Sürüm bilgisi |
