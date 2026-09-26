# DFT Modules

| Klasör | Amaç | Müşteriye gider? |
|--------|------|------------------|
| `dft_license` | Runtime doğrulama / kota / store | Evet |
| `dft_license_issuer` | Token üretimi (CLI/GUI / EXE) | **Hayır** |
| `dft_packager` | Anahtar teslim kurulum paketi | Kurulum çıktısı evet; issuer hayır |

## Hızlı kullanım

```bash
# Demo lisans (bu makine — Python)
set PYTHONPATH=C:\votex\modules
python -m dft_license_issuer --plan demo --activate

# GUI üretici (Python)
python -m dft_license_issuer

# Python'suz PC için EXE (build PC'de bir kez)
modules\dft_license_issuer\HAZIRLA_EXE.bat
# → dist\DFT_Lisans_Uretici\DFT_Lisans_Uretici.exe

# Kurulum paketi iskeleti
python modules/dft_packager/build.py
```

## Lisans akışı (üretici ↔ müşteri)

1. **Müşteri:** VOTEX Lisans → «Makine kodunu kopyala» → size gönderir  
2. **Siz (üretici PC):** `DFT_Lisans_Uretici.exe` — kodu yapıştır → plan → Üret → token verin
3. **Müşteri:** token yapıştır → Aktifleştir

### Makine taşıma (kalan gün)

Aynı kullanıcı / yeni PC’de tam `m1` (30 gün) vermemek için:

1. Eski PC rozetinden kalan günü not et (örn. `M1 · 18g`)
2. Yeni PC makine kodunu al
3. Üretici: Tür = **lisans**, Plan = **m1**, **Kalan gün = 18**, HWID yapıştır → Üret
4. Yeni PC’de token’ı aktifleştir → rozet `M1 · 18g` olur

CLI: `python -m dft_license_issuer --plan m1 --days 18 --hwid <YENI_HWID>`

Alternatif: yeni PC’de zaten geçerli lisans/demo varken Tür = **gün kredisi** (+N) — mevcut süreye ekler.

Üretici EXE müşteriye kurulmaz. (Kalan günü müşteri VOTEX içinde yazamaz; imzalı token gerekir.)
