# Saha operatör kartı — DTA → Votex

Tek sayfa. Renk ipucu → RAPOR → ZIP → ofis.

## Renk → anlam (manyetik ışın modeli)

| Renk | Anlam |
|------|--------|
| Kırmızı | Metal çekirdek (ana manyetik veri) |
| Mavi | Boşluk çekirdek (ana manyetik veri) |
| Açık ton / sarı-turuncu / krem (çekirdek çevresi) | Yeryüzüne fırlayan ışın — şekil sınırı (wall) |
| Yeşil | LiDAR / toprak yüzeyi (zemin sıfır) |
| Yeşil üstünde ince beyaz çizgi | Oda / tünel yapı izi (glow) |

Metal yalnızca kırmızıdır. Sarı/turuncu metal değildir.

Manyetik önce; termal ikinci doğrulama. Sesli yanıt **hipotez**dir.

## DTA tablet döngüsü

1. Proton ELIC açık, manyetik (gerekirse termal).
2. İsteğe bağlı: saha **En×Boy** + köşeler (survey).
3. **BAŞLA** → kayıt; **BEKLE** duraklat; **BİTİR** bitir.
4. **RAPOR** → `reports/elic_cases/*.zip` (schema 1.0).
5. Aktif survey varsa ZIP içinde `survey.json` otomatik gelir → Votex’te En×Boy sormaz.

## Votex ofis

1. **ELIC Case ZIP Aç** → 3D volume + analyzer paneli.
2. Panel: disclaimer, hipotezler, ses özeti, **PhysicsBridge**, REC (varsa).
3. Bridge **sapma** uyarısı → ofiste `screen.png` / Votex volume esas alınsın.
4. Tolerans: panelde **PhysicsBridge tolerans (%)** (varsayılan **8**).
5. Masaüstünde **Son case’ler → Aç** (kayıtlı path ile yeniden yükleme).

### DTA ile VOTEX ekranı yorumu (`C:\votex`)

Çift monitör: ELIC + VOTEX açıkken DTA’ya söyle:
- **“Ekranı yorumla”** / **“İki ekrana bak”** → her iki pencereyi tarar
- VOTEX görünürse yerel heatmap/HUD/inference + 3D INTEL ile değerlendirir
- **“Burada oda olabilir”** / **“Eksik odayı çiz”** / **“VOTEX’e yönlendir”** → `guide_votex` ile 3D’ye müdahale (localhost `127.0.0.1:18765`)
- Önce VOTEX’te harita yükleyip **3D oluştur** (köprü son oturumu kullanır)
- Pencere: `votex_window_title` (varsayılan `Votex`; başlıkta `Manyetik Anomali` de yeter)
- Kılavuz: `schema/VOTEX_EKRAN.md`

## Bridge uyarısı

DTA paketindeki ısı %’leri ile Votex’in `screen.png` yeniden sınıflandırması ±tolerans dışında ise sapma sayılır. Çıktıyı buna göre not edin; paket silinmez.

## Smoke (kısa)

```powershell
# DTA
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python tests\test_votex_import.py

# Votex
cd C:\Votexyeni
npm run test:elic-case
```

Ayrıntılı checklist: `tests/ELIC_SAHA_TEST.md` → bölüm **ZIP → Votex**.
