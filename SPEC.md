# APP SPEC — Popup Reminder System
> Windsurf'e verilecek master spec. Buraya bakarak kod yaz.

---

## 1. Genel Bakış

Kullanıcının yapmak isteyip harekete geçemediği konuları agresif popup'larla hatırlatan bir masaüstü + Android uygulaması.

- **Desktop:** Electron (Windows)
- **Mobil:** Capacitor (Android)
- **Data:** SQLite — local, iki platform birbirinden bağımsız
- **UI dili:** Türkçe
- **Stack:** HTML + CSS + JavaScript (Electron + Capacitor)

---

## 2. Veri Modeli

### `categories` tablosu
```
id          INTEGER PRIMARY KEY
name        TEXT              -- örn: "Yapay Zeka"
color       TEXT              -- hex kodu, örn: "#6C63FF"
triggers    TEXT              -- JSON array, window title keyword listesi
            -- örn: ["Claude", "ChatGPT", "Gemini"]
created_at  INTEGER           -- timestamp
```

### `tips` tablosu
```
id            INTEGER PRIMARY KEY
category_id   INTEGER           -- FK → categories
content       TEXT              -- hatırlatma metni
importance    INTEGER           -- 1–10 arası kullanıcı tanımlı
show_count    INTEGER DEFAULT 0 -- kaç kez gösterildi
status        TEXT DEFAULT 'active'
              -- 'active' | 'retired' | 'done'
              -- done: kullanıcı "hallettim" dedi
              -- retired: 5 kez gösterildi, otomatik
last_shown    INTEGER           -- timestamp
created_at    INTEGER
```

### `dismiss_log` tablosu
```
id          INTEGER PRIMARY KEY
tip_id      INTEGER
reason      TEXT    -- 'no_time' | 'dont_know_how' | 'no_motivation' | 'not_now'
            -- null: kullanıcı seçmeden kapattı
dismissed_at INTEGER
```

### `sessions` tablosu (Focus/Hot Mode için)
```
id            INTEGER PRIMARY KEY
category_id   INTEGER
started_at    INTEGER
ended_at      INTEGER
```

### `checkins` tablosu (Android için)
```
id          INTEGER PRIMARY KEY
date        TEXT    -- 'YYYY-MM-DD'
completed   INTEGER DEFAULT 0  -- bool
streak      INTEGER DEFAULT 0
```

---

## 3. Desktop — Electron

### 3.1 System Tray

- Uygulama sadece system tray'de yaşar, penceresi yoktur
- Tray icon animasyonlu olacak: sürekli hafif hareket (pulse veya bounce loop)
- Sağ tık menüsü:
  - Kategorileri Yönet
  - Aktif Focus Modu (açık/kapalı toggle + hangi kategori)
  - Ayarlar
  - Çıkış

### 3.2 Popup Tetikleme

**Trigger kaynakları:**

1. **Window Title Tracking** — Her 5 saniyede bir aktif pencerenin title'ı kontrol edilir.
   - Kategorideki `triggers` listesindeki keyword'lerden biri title'da varsa → o kategoriden tip seç → popup göster
   - Sadece aktif (foreground) pencere için kontrol et
   - Fullscreen pencere varsa (oyun, video) → tetikleme

2. **Random "N'aber?" Popup** — Rastgele aralıklarla (30–90 dakika arası random) çıkar
   - Tam ekran uygulama yoksa tetiklenir
   - Kategoriden bağımsız, genel bir "Ne durumdasın?" tarzı
   - İçerik: O gün henüz gösterilmemiş bir tip veya check-in sorusu

**Tetikleme sonrası tip seçimi:**
- O kategorinin `status = 'active'` tipleri arasından `importance` ağırlıklı random seç
- Son 1 saatte gösterilmiş tip tekrar seçilmez
- Active tip yoksa: retired tipler arasından "Hâlâ yapıyor musun?" popup'ı

### 3.3 Popup Anatomy

Her popup şu bileşenleri içerir:

```
┌─────────────────────────────────┐
│  [Kategori Adı]  [Kategori Rengi]│
│                                  │
│  Tip içeriği buraya              │
│                                  │
│  [2 Dakika Yap]  [Dismiss]       │
│                                  │
│  Dismiss sebebi (3sn sonra çıkar)│
│  [Zaman yok] [Bilmiyorum]        │
│  [Motivasyon yok] [Şimdi değil]  │
└─────────────────────────────────┘
```

- Popup her seferinde 3 pozisyon varyantından birini random seçer:
  - **Varyant A:** Buton sağda
  - **Varyant B:** Buton solda
  - **Varyant C:** Buton ortada
- Popup arka planı hafif frosted glass efekti
- Ekranda her zaman sağ-alt köşede başlar, varyanta göre buton pozisyonu değişir

### 3.4 Dismiss Seviyeleri

Importance 1–10, dismiss mekanizması:

| Seviye | Mekanizma |
|--------|-----------|
| 1–3 | Tek tık buton, anında kapanır |
| 4–6 | 10 saniye hold-to-dismiss. Progress bar dolar. Bırakırsan sıfırlanır. |
| 7–9 | Matematik sorusu. Örn: "47 + 38 = ?" Doğru cevap girilince kapanır. |
| 10 | Aşağıda detaylı açıklandı |

**Level 10 dismiss akışı:**
1. Popup açılır, arka plan müzik build-up başlar
2. Buton hafifçe sallanır (CSS shake animation, giderek artar)
3. Popup'ın kenarlarından yavaşça konfeti parçaları birikmeye başlar (canvas layer)
4. Kullanıcı butonu hold eder (10 saniye), progress bar dolar
5. 10. saniyede: konfeti patlar (burst animation), hit ses efekti çalar, popup kapanır
6. Bırakırsa sıfırlanır, konfeti de sıfırlanır

### 3.5 "2 Dakika Yap" Butonu

- Her popup'ta dismiss butonunun yanında küçük "2 dk" butonu
- Basınca popup kapanır
- Floating mini-timer açılır (ekranın bir köşesinde, küçük, drag edilebilir)
- 2 dakika sonra yeni popup: "Devam ettin mi?" → [Evet] [Hayır]
- Evet → tip show_count artar, normal akış
- Hayır → aynı tip tekrar gösterilir, bu sefer dismiss sebep sorusu önce gelir

### 3.6 Dismiss Sebep Tracking

- Popup dismiss edildiğinde 3 saniye boyunca 4 küçük buton belirir
- `[Zaman yok] [Nasıl yapacağımı bilmiyorum] [Motivasyon yok] [Şimdi değil]`
- 3 saniye seçilmezse kapanır, log'a `reason: null` düşer
- dismiss_log tablosuna kaydedilir

**Pattern analizi görünümü** (Ayarlar > İstatistikler):
- Her tip için en sık dismiss sebebi
- "Bu konuyu X kez 'motivasyon yok' diyerek geçtin" tarzı özet

### 3.7 Focus / Hot Mode

- Tray menüsünden aktif edilir: hangi kategori seçilir
- Aktifken:
  - Seçili kategorinin popup'ları 2x sıklıkta gelir
  - Diğer kategoriler susar
  - Tray icon rengi o kategorinin rengine döner
- Tray menüsünden veya session end ile kapatılır

### 3.8 İçerik Yaşam Döngüsü

```
active → (5 kez gösterildi) → retired
active → (kullanıcı "Hallettim" dedi) → done
retired → (arada "Hâlâ yapıyor musun?" popup'ı) → kullanıcı "Evet yapıyorum" → active
retired → (kullanıcı "Evet hallettim" → done
```

### 3.9 Ses & Müzik

- Uygulama açılınca arka plan müzik fade in ile başlar (kullanıcı verdiği dosya)
- Kapanınca fade out
- Her dismiss level'ının kendine ait ses efekti (kullanıcı assign eder)
- Level 10'da özel build-up ses + hit sesi
- Ses dosyası formatları: mp3, wav, ogg
- Ses ayarları: Ayarlar panelinden volume kontrolü

### 3.10 Ayarlar Paneli

- **Kategoriler:** Ekle / Düzenle / Sil, renk seç, trigger keyword'leri tanımla
- **Tipler:** Kategori bazlı liste, importance ayarla, durum değiştir
- **Sesler:** Her seviye için ses dosyası assign et, arka plan müzik seç
- **Zamanlama:** Random popup aralığı (default 30–90 dk, değiştirilebilir)
- **UI Variables (alpha için):** Primary color, accent color, border radius, button size — bunlar tek yerden değiştirilebilir CSS variables olarak tanımlanır
- **İstatistikler:** Dismiss sebep analizi, streak bilgisi

---

## 4. Android — Capacitor

Desktop ile aynı web kodu temel alınır, Capacitor ile Android'e sarılır.

### 4.1 Overlay Popup

- `SYSTEM_ALERT_WINDOW` permission gerektirir
- Kullanıcı onay adımı uygulama ilk açılışında gösterilir
- Full-screen overlay, dokunulamayan arkayı bloke eder
- Aynı dismiss level sistemi geçerlidir (1–10)

### 4.2 Zamanlama

- Kullanıcı şunu ayarlar:
  - Günde kaç popup (örn: 5)
  - Zaman dilimi (örn: 09:00–22:00)
  - Uygulama bu aralığa günde N popup rastgele dağıtır
- `@capacitor/local-notifications` ile implement edilir

### 4.3 Check-in & Reward

- Günde bir kez (kullanıcı tanımlı saat) check-in popup'ı gelir
- "Bugün konularına bir göz attın mı?" → [Evet] [Hayır]
- Evet → streak artar, reward mesajı: "Tebrikler! Bugün popup'ların %20 daha az agresif."
  - Bu gün içinde importance değerleri -2 offset ile çalışır (floor 1)
- Streak kırılırsa sıfırlanır, motivasyon mesajı gösterilir

### 4.4 Veri

- Android kendi SQLite'ını kullanır, desktop ile sync yoktur
- Kategoriler ve tipler Android'e ayrıca girilir (veya ilk kurulumda JSON import desteklenir)

---

## 5. UI Tasarım Prensipleri

- **Sade ama kaliteli.** Gereksiz element yok, olanlar iyi yapılmış.
- **Efektler anlamlı.** Sadece dismiss mekanizmasında animasyon var, her yerde değil.
- **CSS Variables:** Tüm renkler, border-radius, font-size, spacing değerleri dosyanın tepesinde CSS variable olarak tanımlı. Alpha'da kolayca değiştirilebilir.
- **Frosted glass popup:** `backdrop-filter: blur()` + yarı şeffaf arka plan.
- **Font:** System font stack, ekstra font yükleme yok.
- **Dark mode:** Default dark, light mode sonraya bırakılır.

---

## 6. Proje Klasör Yapısı (Windsurf'e Öneri)

```
/
├── electron/
│   ├── main.js           # Electron ana process, tray, window title tracker
│   ├── preload.js
│   └── db.js             # SQLite işlemleri
├── src/
│   ├── index.html        # Ana sayfa (ayarlar paneli)
│   ├── popup.html        # Popup penceresi
│   ├── styles/
│   │   ├── variables.css # TÜM CSS variables buraya
│   │   ├── popup.css
│   │   └── settings.css
│   ├── js/
│   │   ├── popup.js      # Dismiss level logic, animasyonlar, timer
│   │   ├── settings.js   # Kategori/tip yönetimi
│   │   ├── audio.js      # Ses fade, efekt oynatma
│   │   └── analytics.js  # Dismiss pattern hesaplama
│   └── assets/
│       └── sounds/       # Kullanıcı ses dosyaları buraya kopyalanır
├── android/              # Capacitor Android projesi (generate edilir)
├── capacitor.config.json
└── package.json
```

---

## 7. Alpha Scope — Ne Var, Ne Yok

### ✅ Alpha'da var
- Kategori + tip CRUD (ayarlar paneli)
- Window title tracking tetiklemesi
- Tüm dismiss seviyeleri (1–10)
- Level 10 konfeti + animasyon + ses
- "2 dakika yap" timer
- Dismiss sebep tracking + basit istatistik
- Focus / Hot mode
- Random "N'aber?" popup
- İçerik yaşam döngüsü (5 gösterim → retired, hallettim → done)
- Ses dosyası assign + arka plan müzik fade
- Android overlay popup + scheduling + check-in reward

### ❌ Alpha'da yok (v2)
- Desktop ↔ Android sync
- iOS desteği
- Level 10 Wordle (şimdilik hold-to-dismiss)
- Cloud backup
- Bildirim geçmişi görünümü
- Widget (Android)

---

## 8. İlk Build Sırası (Windsurf için)

1. Electron projesi kur, SQLite bağla, temel tablo yapısını oluştur
2. Ayarlar paneli — kategori ve tip CRUD çalışır hale getir
3. Popup penceresi — tüm dismiss seviyeleri implement et
4. Window title tracker — tray'e entegre et
5. Ses sistemi — fade in/out, efekt oynatma
6. Level 10 animasyonlar — konfeti canvas, shake, build-up
7. "2 dakika yap" timer
8. Dismiss sebep tracking + istatistik sayfası
9. Focus mode
10. Capacitor wrap — Android'e taşı, overlay + scheduling + check-in
