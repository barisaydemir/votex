# VOTEX 0.1.74 — Sürüm Notları

**Yayın Tarihi:** Ağustos 2026  
**Sürüm:** 0.1.74  
**Geliştirici:** Digital Future Tech (Barış Aydemir)

---

## 🎯 Bu Sürümde Neler Var?

VOTEX 0.1.74, **3D görüntüleyicide büyük performans iyileştirmeleri**, **yeni analiz araçları** ve **kullanım kolaylığı** getiren kapsamlı bir güncelleme. Önceki sürümlerdeki kasma sorunları kökten çözüldü, sahne artık akıcı çalışıyor.

---

## ⚡ Performans İyileştirmeleri

### Artık Boşta Sessiz
Uygulama açıkken ama siz bir şey yapmıyorken artık **sıfır CPU ve GPU** harcıyor. Eski sürümlerde arka planda sürekli çalışan zamanlayıcılar ve animasyonlar temizlendi.

### Entegre GPU Desteği
Laptop ve zayıf donanımlarda otomatik kalite ayarı devreye giriyor:
- Kamera hareket ederken FPS otomatik ölçülüyor
- Düşük FPS algılanırsa gölge çözünürlüğü ve piksel oranı kademeli olarak azaltılıyor
- Güçlü bilgisayarlarda tam kalite, zayıf bilgisayarlarda akıcı çalışma

### Şık Zemin
Zemin dokusu artık uzak planda **titreşmiyor**. Mipmap ve anizotropik filtreleme sayesinde eğik açılarda dahi net görünüyor.

---

## 🗡️ Yeni Özellikler: Kesit Modu

Zemin above spots underneath — built-in clipping tool:

- **Kesit Modu (K tuşu):** Zemin tabakasını yukarı-aşağı hareket ettirerek yeraltı yapılarını "soyulmuş" toprak gibi görüntüleyin. Tünel ve odalar toprak altında kalsa bile kesit düzleminin üzerindeyseler görünür kalır.
- **Kesit Yüksekliği (↑/↓ tuşları):** Klavye ok tuşlarıyla kesit düzlemini ±1 metre aralıklarla hareket ettirin.
- **Otomatik Aralık:** Kesit slider'ı haritanın derinliğine göre otomatik ayarlanır — -33m'den +3m'e kadar.

---

## 👁️ Yeni Özellikler: X-Ray Görünümü

**X tuşu** ile yapıları yarı saydam holograma dönüştürün:
- Tüm yapılar (oda, tünel, metal) kameraya göre **fresnel parlaması**yla çizilir
- Kenarlar parlak, orta bölgeler şeffaf — yapıların içi ve arkası okunur
- Kesit moduyla birlikte kullanıldığında yeraltı **tamamen çıplak** görünür

---

## 📋 Analiz Raporu: Metal Anomalileri Artık Öncelikli

Eskiden sadece oda ve tüller raporda listeleniyordu. Artık:
- **Değerli metal tespitleri** (Au/Ag/Fe) de öncelik sırasına giriyor
- Tüm tespitler **ardışık numaralandırılıyor** (1, 2, 3... — eskisi gibi hepsi "1." değildi)
- Metal tespitlerinin gücüne göre yüksek/orta güvenilirlik ayrımı yapılıyor

---

## 🎨 3D Görüntüleyici İyileştirmeleri

### Derinlik Kontur Çizgileri
Zemin üzerine her derinlik adımında ince **eşyükselti eğrileri** eklendi. Tıpkı topoğrafik haritalardaki gibi — zeminin derinliğini çizgiler sayarak okuyabilirsiniz.

### Etiket Zekası
- Yapı etiketleri zeminin **arkasına geçtiğinde** otomatik olarak şeffaflaşıyor
- Uzak etiketler **solar** — yakın olanlar okunabilir kalıyor
- Kalabalık sahnelerde rozetler birbirine girmiyor

### Sinematik Görünüm
- ACES Filmik ton haritalama ile **sinematik renk kalitesi**
- Ortam yansımaları (RoomEnvironment) ile metal ve yüzeyler doğal görünüyor
- Yumuşak gölgeler yapıların derinliğini vurguluyor

---

## ⌨️ Klavye Kısayolları

| Tuş | İşlev |
|-----|-------|
| **K** | Kesit modunu aç/kapa |
| **X** | X-Ray görünümünü aç/kapa |
| **↑** | Kesit yüksekliğini +1 m artır |
| **↓** | Kesit yüksekliğini −1 m azalt |

*Not: Bir metin kutusunun içine tıkladığınızda kısayollar otomatik devre dışı kalır.*

---

## 🐛 Hata Düzeltmeleri

- **Kasma sorunu:** Uygulama boşta beklerken arka planda gereksiz çalışan süreçler temizlendi
- **EKG animasyonu:** 60 fps sonsuz döngü yerine 25 fps ile çalışıyor; pencere gizliyken tamamen duruyor
- **Zamanlayıcı sızıntısı:** DTA ve VotexProb durum kontrolü pencere arka plandayken durduruluyor
- **Panel.temizleme:** Gizli paneller artık gereksiz CPU harcamıyor
- **Kesit shader:** Slider her hareket ettirildiğinde shader yeniden derlenmiyor — ilk geçişte 1 kez, geri kalanı bedava

---

## 📦 Yükleme

Yeni kurulum paketi:
```
Votex_0.1.74_x64-setup.exe (~220 MB)
```

Kurulum otomatik olarak eski sürümün üzerine yükleme yapar. Oturumunuz ve ayarlarınız korunur.

---

## 💡 Güncelleme İçin İpuçları

1. Eski VOTEX penceresini kapatın
2. `Votex_0.1.74_x64-setup.exe` dosyasını çalıştırın
3. Kurulum tamamlandıktan sonra yeni sürümü başlatın
4. İlk kullanımda kesit (K) ve X-Ray (X) kısayollarını deneyin

---

## 🔮 Gelecek Sürümde Neler Olacak?

- **Harita-level zoom:** Yakınlaştırma傑agosunu iyileştirme
- **PDF dışa aktarma:** Analiz raporunu PDF olarak kaydetme
- **Çoklu harita karşılaştırma:** İki haritayı yan yana görüntüleme
- **Mobil duyarlılık:** Dokunmatik ekran etkileşimi

---

*VOTEX 0.1.74 — Digital Future Tech © 2026*  
*Hata bildirimi ve öneriler: destek@digitalfuture.tech*
