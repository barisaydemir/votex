# FAZ DURUM RAPORU — DTA → Votex ELIC Case

## DTA (Surface-z) — Faz 0–4 + Sprint A1 TAMAMLANDI

## VOTEX (`C:\Votexyeni`) — V1–V4 + Sprint A TAMAMLANDI

| Adım | İş | Durum |
|------|-----|--------|
| V1 | ZIP import + buton + step26 | TAMAMLANDI |
| V2 | Analyzer DTA Case paneli | TAMAMLANDI |
| V3 | Consolidated rapor tohumu + export | TAMAMLANDI |
| V4 | PhysicsBridge sapma uyarısı + REC badge | TAMAMLANDI |
| A1 | RAPOR’da aktif survey → `survey.json` | TAMAMLANDI |
| A2 | Saha smoke + `npm run test:elic-case` | TAMAMLANDI |
| A3 | Son case’ler (localStorage + Tauri path) | TAMAMLANDI |
| A4 | `schema/SAHA_KILAVUZ.md` | TAMAMLANDI |
| A5 | Bridge tolerans ayarı + panelde görünür | TAMAMLANDI |

### Sprint A dosyalar
- DTA: `actions/elic_case_export.py` (`survey_payload_from_session`)
- DTA: `tests/ELIC_SAHA_TEST.md` (ZIP → Votex), `schema/SAHA_KILAVUZ.md`
- Votex: `src/api/elic-case-recents.js`, `src/config/elic-case.js`
- Votex: panel Son case’ler + PhysicsBridge tolerans (%)
- Votex: `npm run test:elic-case` (step26–28)

### Saha→ofis smoke
1. DTA RAPOR (+ isteğe bağlı REC / aktif survey)
2. Votex **ELIC Case ZIP Aç** (survey varsa En×Boy yok)
3. Panel: disclaimer + bridge (±tolerans) + hipotezler
4. Masaüstü: Son case’ler → Aç
5. HTML indir / kılavuz: `SAHA_KILAVUZ.md`
