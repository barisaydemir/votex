# VOTEX ekran tanımı — DTA yorum kılavuzu

DTA, Proton ELIC’i sahada okur; **VOTEX** ofiste aynı manyetik haritayı 3D yapıya çevirir.
Kullanıcı “VOTEX ekranını yorumla” dediğinde `analyze_votex_screen` kullanılır.

## Pencere tanıma

- Başlıkta genelde: `VOTEX`, `Votex`, `Tactical Command`
- Config: `votex_window_title` (varsayılan `Votex`)

## Ekran düzeni (3 panel)

| Bölge | Ne |
|--------|-----|
| Sol OPS | Dosya, dik/yan çekim, hedef tipi, min güven, telemetri, 2D önizleme |
| Orta STAGE | 3D tactical view — colormap zemin + yapılar |
| Sağ INTEL | Doğrulama raporu: kabul/red, oda, şaft, tünel, metal sayıları + yapı listesi |

## Çekim tipi

- **Dik çekim:** plan haritası; X/Y yatay; derinlik sinyalden (~10 m)
- **Yan çekim:** kesit; görüntü üstü = yüzey, altı = derinlik (~3 m); X = hat mesafesi

## Renk (colormap / zemin)

ELIC ile aynı manyetik skala:

| Renk | Anlam |
|------|--------|
| Yeşil | Zemin sıfır |
| Mavi | Boşluk / oda / tünel adayı |
| Kırmızı | Metal / güçlü manyetik alan (boşluk içinde de olabilir) |
| Sarı / açık | Geçiş / fışkırma |
| İnce beyaz çizgi | Duvar / yapı ipucu (kesin değil) |

## 3D yapılar (okuma)

| Mesh | Anlam |
|------|--------|
| Şeffaf / tel kutu (oda) | Mavi boşluk → oda/mezar; yan çekimde mavi leke üstünde, ince kesit |
| Kemerli koridor | Tünel; üstü kemerli |
| Kırmızı-kahve blok | Manyetik alan / metal; `tünel içi` ise anomali koridorun içinde |
| Konum balonu + no | Yapı numarası (pin) |

## INTEL sayıları

- **Oda/Mezar** → mavi void odaları
- **Tünel** → koridor / bağlantı
- **Metal** → kırmızı alanlar (yapı değil; yapı içinde olabilir)
- **Şaft** → dikey kuyu (çoğunlukla dik çekim)

## Yorum kuralları

1. Önce çekim tipini oku (sol panel: DİK / YAN).
2. 3D’de mavi üstündeki odalar ile kırmızı metal/tünel ilişkisini söyle.
3. “Tünel içi” / “oda içi” metal → boşluk içi hedef hipotezi.
4. INTEL sayıları ile sahneyi çaprazla; çelişkide 3D + colormap esas.
5. İnce çizgi / glow = ipucu; kesin tespit deme.
6. Kısa saha dili; sonraki adım (ELIC termal / yeni çekim) öner.

## DTA yönlendirme (`guide_votex`)

Eksik oda/tünel görülürse DTA `guide_votex` ile VOTEX’e müdahale eder:
- Köprü: `http://127.0.0.1:18765/guide`
- İpucu: `{kind, cx, cy, rx?, ry?, label?}` — konum 0–1 normalize
- VOTEX açık + en az bir 3D analiz yapılmış olmalı; sahne yeniden hesaplanır

## Legacy3DMAG dik çekim (JSON) modu

VOTEX'e Legacy3DMAG JSON yüklendiğinde ekran dik çekim (adım karesi) moduna geçer.

### Nasıl tanınır

- Sol panelde Legacy3DMAG dik çekim kartı: adım sayısı, tespit/hedef listesi, kalibrasyon rozeti
- Sahnede adım şablonu: satır×sütun kare grid (ör. 6×3 = 6 satır 3 sütun)
- Kırmızı dolu blok = ölçülen tespit footprint'i (yalnız kendi ölçülen boyutu kadar)

### ADIM okuma

- Her adım bir KAREdir; numaralandırma varsayılan SAĞDAN SOLA (RTL)
- Adım seçilince yalnız o kare + o adımın objeleri/etiketleri görünür; diğer adımlar gizlenir
- "Temizle" tüm sahayı geri getirir; kareler arasındaki BÜYÜK boşluklar boş kalmalıdır (doldurma yok)

### DERİNLİK okuma

- Etiketlerde derinlik METRE olarak net yazar (üst–alt aralık, ör. 1.20–1.80 m)
- 1 m referans kazığı kalibrasyonu yapıldıysa değerler kalibre edilmiş proxy'dir; kesin ölçüm değildir

### GÜVEN okuma

- Her tespitte yüzde güven + durum etiketi: GÜÇLÜ / DİKKAT / NORMAL
- GÜÇLÜ → hedef çevresinde doğrulama taraması öner; NORMAL → tek başına kazı kararı verme

### LATERAL YANIT okuma (kritik)

- Komşu adımda görülen benzer sinyal = "lateral yanıt adayı": AYNI KAYNAKTAN gelme OLASILIĞI
- Ekranda: Kanıt görünümünde KESİKLİ MAVİ ince çizgi + uç işaretleri
- Bu çizgi fiziksel bağlantı veya birleşme kararı DEĞİLDİR; footprint boyutlarını büyütmez
- Derin hedeflerde komşu adım örtüşmesi FİZİKSEL olarak beklenebilir (yanıt alanı derinlikle genişler)
- Birleşik hedef = birkaç kanıttan birleşen fiziksel hedef adayı; kartta kanıt sayısı + yatay bağlantı yazar

### Yorum dili

1. Tüm değerleri proxy olarak sun; malzeme kimliği veya kesin teşhis verme.
2. Lateral çizgiyi "aynı hedef olabilir" diye anlat; "kesin birleşti" DEME.
3. Derinlik + güven + lateral adayları birlikte yorumla; çapraz tarama öner.
