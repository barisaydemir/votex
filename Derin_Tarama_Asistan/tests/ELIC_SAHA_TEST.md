# ELIC Saha Test Checklist

Bu liste, Windows tablette Proton ELIC programi yaninda ELIC Asistan'in dogrulanmasi icindir.

## On kosullar

- [ ] `config/api_keys.json` icinde `gemini_api_key` dolu
- [ ] `config/license.dat` gecerli lisans veya aktivasyon kodu (bkz. asagi)
- [ ] `elic_window_title` degeri, tablette ELIC programinin gercek pencere basligini iceriyor
- [ ] `ui_profile` degeri `tablet`
- [ ] Internet baglantisi aktif
- [ ] Mikrofon izni verilmis

## Otomatik on-test (masaustu)

```powershell
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python tests\run_field_test.py
```

0. [ ] HWID, lisans, HUD ornek, survey geometri, sensor testleri GECTI
1. [ ] Proton ELIC acikken `elic_window` satiri OK

## Lisans aktivasyonu

```powershell
# DEMO 7 gun (bu tablet)
.venv_jarvis\Scripts\python tools\issue_license.py --mode trial --days 7 --activate

# Tam lisans 1 yil (gelistirme)
.venv_jarvis\Scripts\python tools\issue_license.py --mode full --days 365 --activate
```

Cihaz ID icin: script ciktisindaki `HWID short` veya uygulama lisans ekrani.


1. [ ] ELIC programini tablette ac
2. [ ] `baslat.bat` ile ELIC Asistan'i baslat
3. [ ] Asistan penceresi sag kenarda kucuk overlay olarak aciliyor
4. [ ] "ELIC Asistan hazir. Dinliyorum..." mesaji gorunuyor

## Sesli komutlar — ekran analizi

5. [ ] "Ekrani yorumla" — 10 sn icinde sesli yanit
6. [ ] "Derinlik ne kadar?" — Depth/HUD okumasi veya tahmin
7. [ ] "Metal mi bosluk mu?" — anomali turu yorumu
8. [ ] "Pil durumu nedir?" — sys_info battery calisiyor

## ELIC / NAV / KAYIT butonlari

9. [ ] **ELIC ▸** butonuna tikla — analiz tetikleniyor
10. [ ] Logda "USR: ELIC ekranini analiz et" yaziyor
11. [ ] **NAV ▸** butonuna tikla — "Dorduncu koseye yonlendir" komutu gidiyor
11b. [ ] **BAŞLA ●** — Proton ELIC acikken kayit baslar, logda REC
11c. [ ] **RAPOR** — ELIC Case ZIP uretir (`reports/elic_cases/`), schema 1.0
11c. [ ] **BEKLE ▐▐** — kayit duraklar; tekrar BEKLE devam eder
11d. [ ] **BİTİR ■** — `recordings/elic_*/elic_capture.mp4` (veya .gif) olusur
11e. [ ] Kareler `recordings/elic_*/frames/frame_XXXXXX.png` olarak da kalir

## Pencere hedefleme

12. [ ] ELIC acikken analiz basarili
13. [ ] ELIC kapaliyken anlasilir hata mesaji (pencere bulunamadi)

## Parser / HUD dogrulama (yerel)

```powershell
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python -c "from pathlib import Path; from actions.compass_reader import read_elic_hud; import json; p=Path('tests/sample_elic_screen.png'); print(json.dumps(read_elic_hud(p, use_gemini=False), indent=2, ensure_ascii=False) if p.exists() else 'ornek ekran yok')"
```

14. [ ] `heatmap_stats` metal/void/soil yuzdeleri mantikli
15. [ ] `surface_ref_ok` alani mevcut (LiDAR yesil zemin)
16. [ ] `active_sensor` alani `magnetic` veya `thermal`
17. [ ] `heading_deg` / `heading_cardinal` okunabiliyor (Gemini ile veya heuristik)

## Cift sensor dogrulama

18. [ ] Manyetik modda bosluk tespitinde termal gecis onerisi geliyor
19. [ ] "Termal ile dogrula" — verify_with_thermal capraz rapor uretiyor
20. [ ] Termal moda gecmeden verify_with_thermal anlasilir uyari veriyor

## Kose yonlendirme (10 x 15 m dikdortgen saha)

### Hazirlik

- [ ] Saha boyutunu not al: genislik 10 m, uzunluk 15 m
- [ ] ELIC acik, manyetik mod aktif

### Adimlar

21. [ ] "Taramayi baslat, on metre on bes metre" → start_survey calisiyor
22. [ ] Birinci fiziksel kosede "Kose bir" → mark_survey_corner(1) basarili
23. [ ] Ikinci kosede "Kose iki" → pusula + derinlik logda gorunuyor
24. [ ] Ucuncu kosede "Kose uc" → 4. kose tahmini sesli bildiriliyor
25. [ ] UI'da kose sayaci "Kose 3/4" gorunuyor
26. [ ] Mini haritada 3 isaretli kose + tahmini 4. kose (4?) noktasi var
27. [ ] "Dorduncu koseye yonlendir" → yon + mesafe sesli geliyor
28. [ ] NAV butonu ile yonlendirme tekrarlanabiliyor
29. [ ] Hedef koseye ulasinca "Kose dort" ile tamamlanabiliyor
30. [ ] get_survey_status tum koseleri listeliyor

### Beklenen geometri

- Kose 1 = (0, 0)
- Kose 2 = (10, 0)
- Kose 3 = (10, 15)
- Kose 4 (tahmini) = (0, 15) — D = A + C - B

## ZIP → Votex (ofis köprüsü)

Önce otomatik, sonra saha/ofis elle:

```powershell
# DTA: sample → ZIP + survey.json + validate
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python tests\test_votex_import.py
```

```powershell
# Votex: step26–28 smoke (tek komut)
cd C:\Votexyeni
npm run test:elic-case
```

37. [ ] Aktif survey ile **RAPOR** — ZIP içinde `survey.json` (En×Boy)
38. [ ] Votex **ELIC Case ZIP Aç** — survey varsa En×Boy prompt’u **çıkmaz**
39. [ ] Analyzer: disclaimer + hipotezler + voice
40. [ ] PhysicsBridge satırı görünür; tolerans panoda ayarlanabilir (varsayılan %8)
41. [ ] Sapma varsa “screen.png esas” uyarısı anlaşılır
42. [ ] REC varsa panoda REC satırı
43. [ ] Masaüstünde Son case’ler listesi; path varsa **Aç** yeniden yükler
44. [ ] Operatör kartı okundu: `schema/SAHA_KILAVUZ.md`

## Tablet UX

31. [ ] Yatay ve dikey orientasyonda UI okunabilir
32. [ ] Yan paneller (hava/takvim) tablet modunda gizli
33. [ ] Orb, mini harita ve log alani ust uste binmiyor
34. [ ] NAV / ELIC / SEND butonlari sigiyor

## Ag / hata

35. [ ] Internet kesilince baglanti hatasi net
36. [ ] API anahtari yoksa kurulum ekrani cikiyor

## Notlar

- Yanlis renk yorumu: `actions/elic_parser.py` icindeki `extract_physics_signal` esiklerini ayarla
- Pencere bulunamiyor: ELIC pencere basligini Task Manager veya Alt+Tab ile kontrol et, `elic_window_title` guncelle
- Derinlik okunmuyor: Gemini HUD okuma devreye girer; Depth etiketinin ekranda gorunur oldugundan emin ol
- Yonlendirme sapmasi: pusula okumasi saha testinde kalibre edilmeli; dikdortgen disi alanlar Faz 2
