# Lisans politikası — DTA + Votex

Aile: `dft_elic_votex`

## Geliştirme (varsayılan)

`enforce=false` — **engel yok**.

```powershell
# DTA
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python tools\license_enforce.py off
.venv_jarvis\Scripts\python tools\license_enforce.py status

# Votex
cd C:\Votexyeni
npm run license:enforce -- off
npm run license:enforce -- status
```

Ortam değişkeni (üstün): `DFT_LICENSE_ENFORCE=0`

## Saha / başka PC’ye taşıma

Sen açıkça aktif edersin:

```powershell
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python tools\license_enforce.py on --also-votex C:\Votexyeni
```

Tablet/Votex saha ZIP’leri paketlenirken `enforce=true` gömülür.

## Aile anahtarı (tek sefer, iki ürün)

Hedef PC’den:

- DTA: cihaz ID (16 hex) veya tam HWID
- Votex: `XXXX-XXXX-XXXX` (UI’daki cihaz kodu)

```powershell
cd C:\surface-z\Surface-z
.venv_jarvis\Scripts\python tools\issue_family_license.py --days 365 `
  --dta-hwid <sha256> --votex-device ABCD-EF01-2345
```

Çıktı: DTA token + Votex key (+ `reports/family_license_*.json`).

Bu makinede denemek:

```powershell
.venv_jarvis\Scripts\python tools\issue_family_license.py --days 365 --activate
```

## Dosyalar

| Ürün | Policy |
|------|--------|
| DTA | `config/license_policy.json` |
| Votex | `license_policy.json`, `src-tauri/license_policy.json` |

Geliştirmede her zaman `off` bırak; saha paketinden sonra kendi makineni tekrar `off` yap.
