# Tek kurulum dosyası

## Kullanıcıya ne verilir?
**Sadece:** `modules\dft_packager\dist\DFT_Suite_Setup.exe`

Çift tık → yönetici onayı → VOTEX + Node + Rust + WebView2 + VC++ + DTA kurulur.

## Build PC’de üret
```bat
hazirla-kurulum.bat
```
Gerekenler (build PC): Node, Rust, Inno Setup 6  
https://jrsoftware.org/isdl.php

## İki ayrı uygulama (aynı setup içinde)
| VOTEX | DTA |
|-------|-----|
| Tauri / Node+Rust | Python |
| Kısayol: VOTEX | Kısayol: Derin Tarama Asistan |
