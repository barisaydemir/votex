# Votex tarafı — ELIC Case entegrasyon planı (schema 1.0)

DTA (Surface-z) ZIP üretir. Votex (`C:\Votexyeni`) ofiste açar.

## Ne yapılacak (özet)

1. **Import modülü** — `src/api/elic-case-import.js` ✅ (iskelet)
2. **UI butonu** — Veri Kaynağı: “ELIC Case ZIP (DTA)”
3. **main.js** — ZIP → `physicsBlobToDataset(screen.png)` + meta
4. **Analyzer paneli** — hypotheses + voice_summary + disclaimer
5. **Test** — `tests/step26-elic-case-import.test.mjs` + fixture ZIP
6. **(Opsiyonel)** PhysicsBridge: screen yeniden parse vs analysis.json
7. **(Opsiyonel)** recording/ kareleri zaman serisi

## Mevcut Votex yolları (aynadaki kalıp)

| Kalıp | Dosya |
|--------|--------|
| Fiziksel JPEG aç | `btn-load-physics` → `loadImageFromScreen("physics")` |
| Dosya seç | `src/api/pick-file.js` |
| Volume üret | `proton-physics-parser.js` → `physicsBlobToDataset` |
| Depth peek | `elic-overlay.js` → `peekElicFromBlob` |
| Rapor | `consolidated-report.js` / `analyzer.js` |

**Case ZIP için en doğru ayna:** physics JPEG akışı + ZIP meta ekleme.

## ZIP sözleşmesi (DTA’dan gelen)

Zorunlu: `manifest.json`, `analysis.json`, `inference.json`, `voice_summary.txt`, `screen.png`  
Opsiyonel: `survey.json`, `recording/`

## UI / UX

- Buton metni: **ELIC Case ZIP (DTA)**
- Başarı: status’ta case_id + ana hipotez + Depth
- Uyarı bandı: ince çizgiler **ipucu** (disclaimer)
- survey yoksa mevcut En×Boy dialog’u

## Fazlar (Votex)

| Faz | İş | Durum |
|-----|-----|--------|
| V1 | Import + validate + screen→3D | TAMAMLANDI |
| V2 | Analyzer’a inference/hipotez | TAMAMLANDI |
| V3 | Consolidated report tohumlama | TAMAMLANDI |
| V4 | REC frames / bridge sapma uyarısı | TAMAMLANDI |

## DTA referans

- `C:\surface-z\Surface-z\schema\ELIC_CASE_v1.yaml`
- `schema/VOTEX_EKRAN.md` — VOTEX 3D ekran tanımı (DTA yorum)
- `actions/votex_vision.py` — `analyze_votex_screen` aracı
- `actions/votex_case_reader.py` (Python eşdeğer)
- `tools/import_elic_case.py --office --bridge`
