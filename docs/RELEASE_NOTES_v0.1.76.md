# VOTEX 0.1.76 — Sürüm Notları

**Yayın Tarihi:** 27 Ağustos 2026  
**Sürüm:** 0.1.76  
**Geliştirici:** Digital Future Tech (Barış Aydemir)

---

## 🎯 Bu Sürümde Neler Var?

VOTEX 0.1.76, **dışa aktarma raporundaki [object Object] hatasını düzelten** bir bakım sürümüdür. Rapor istatistikleri artık doğru değerleri gösteriyor.

---

## 🐛 Düzeltmeler

### Rapor Dışa Aktarma Düzeltildi
Önceki sürümlerde **📋 Dışa Aktar** butonuyla oluşturulan HTML raporunda Tünel ve Metal sayıları `[object Object]` olarak görünüyordu.

**Neden:** `extractStats` fonksiyonunda `tunnels` ve `metals` özellikleri hem sayı (`.length`) hem de dizi olarak tanımlanmıştı. JavaScript'te son tanımlama kazandığından diziler sayıları ezdi.

**Çözüm:** Sayaçlar `tunnelCount`, `metalCount`, `roomCount`, `totalCount` olarak yeniden adlandırıldı. Diziler (`chambers`, `tunnels`, `metals`) kart oluşturmak için korundu.

---

## 📦 Kurulum

```
Votex_0.1.76_x64-setup.exe
```

1. Installer'ı çalıştırın
2. Kurulum sihirbazını takip edin
3. Uygulamayı başlatın
4. Bir manyetik harita analizi çalıştırın
5. **📋 Dışa Aktar** butonuna basın → Tüm değerler doğru görünecek

---

## 🔄 Yükseltme

0.1.75 sürümü yüklüyse direkt yükseltme yapılabilir. Önceki ayarlar ve harita verileri korunur.

---

**Digital Future Tech** · VOTEX Tactical Geophysics
