# NoteZ Mobile — Plan Entegrasyonu Görev Listesi

Bu dosya, `NoteZ-mobile` gerçek Git clone'u üzerinde çalışacak agent için talimattır.

## Çalışma alanı ve kurallar

- Çalışma dizini: `NoteZ-mobile`.
- Kaynak branch: `mobil`.
- Çalışma branch'i: `codex/mobil-plan-integration`.
- Önce mevcut kodu incele; eski `NoteZ-mobile-previous` klasörünü kaynak kabul etme.
- Mevcut NoteZ mobil mimarisini, route sistemini, repository/domain katmanını ve tasarım dilini koru.
- Bağımsız kök dizindeki eski prototipe veya sahte bir router'a taşıma yapma.
- Her değişiklikten sonra `npm run mobile:check`, `npm run mobile:test` ve gerekiyorsa `npm run mobile:build` çalıştır.

## Hali hazırda tamamlananlar

- Mobil alt navigasyona `Plan` sekmesi eklendi.
- `plan` route'u `src/js/mobile.js` içine bağlandı.
- 24 saatlik SVG zaman çarkı, saat işaretleri ve mevcut zaman çizgisi eklendi.
- Varsayılan uyku, spor ve yemek blokları çarkta gösteriliyor.
- Saat bilgisi taşıyan notlar çarkta pin/çizgi olarak gösteriliyor.
- Su hedefi, 100/250/500 ml ekleme kontrolleri ve hedef üstü turuncu görünüm eklendi.
- Plan durumu localStorage'da tutuluyor ve gün değişince günlük su sıfırlanıyor.
- Temel mobil smoke testleri güncellendi ve mevcut test paketi geçiyor.

## Agent'ın tamamlaması gereken işler

### 1. Gerçek mobil UX doğrulaması

- Uygulamayı gerçek mobil viewport'ta veya yaklaşık `390x844` ölçüsünde aç.
- `Plan` sekmesine git, geri/ileri navigasyonu ve mevcut dört sekmenin bozulmadığını kontrol et.
- Çarkın, su kontrollerinin, saatli notların ve alt navigasyonun yatay taşma yapmadığını doğrula.
- Dokunma hedeflerinin kullanılabilir boyutta olduğunu kontrol et.
- Görsel bir sorun varsa mevcut NoteZ renk, tipografi, kart ve buton sistemine uy.

### 2. Plan verisini düzenlenebilir hale getir

- Uyku başlangıç/bitiş saatlerini Plan ekranından veya mevcut NoteZ ayar akışına uygun bir bottom sheet/modal üzerinden değiştirebil.
- Aktivite bloklarını ekleme, düzenleme ve silme akışını Plan ekranına bağla.
- Başlık, başlangıç, bitiş ve kategori alanlarını kullan; veriyi mümkün olduğunca dakika/standart zaman formatında sakla.
- Gece yarısını aşan blokları ve çakışan blokları bozmadan göster.
- Plan verisini mevcut NoteZ repository'sinden ayrı tutman gerekiyorsa açık ve version'lanabilir bir localStorage anahtarı kullan.

### 3. Saatli not desteğini tamamla

- Mevcut not formunda tarih-only ve tarih+saat değerlerini ayır.
- Kullanıcı bir nota saat verdiğinde ISO/local datetime formatında sakla.
- Saat bilgisi olan notu çarkta tek çizgi/pin olarak doğru gün ve saate hizala.
- Saat bilgisi olmayan notu zaman çarkına pin olarak çizme.
- Not pinine dokunulduğunda mevcut NoteZ not detay ekranını aç.
- Tarih, saat dilimi ve gün değişimi için yerel cihaz saatini tutarlı kullan.

### 4. Su takibini sağlamlaştır

- 100 ml varsayılan seçim olarak korunmalı; `−` ve `+` presetler arasında 100/250/500 ml geçiş yapmalı.
- Su ekleme, azaltma ve hedef değiştirme işlemleri yenileme sonrasında korunmalı.
- Normal ölçek `0 → hedef`, hedef üstü ölçek `hedef → 2×hedef` olmalı.
- `2×hedef` sonrasında sayı doğru kalabilir ancak görsel ilerleme %100'de kalmalı.
- Hedef değiştirildiğinde mevcut tüketimi güvenli biçimde yeniden sınırla.
- Görsel hedef aşımını tıbbi uyarı gibi sunma.

### 5. Test ve teslim

- Plan route'u için render testi ekle.
- Su hedefi, preset, hedef aşımı ve localStorage kalıcılığı için en az temel davranış testleri ekle.
- Saatli not pininin doğru saatte üretildiğini test et.
- `npm run mobile:check`
- `npm run mobile:test`
- `npm run mobile:build`
- `git diff --check`
- Değişen dosyaları ve test sonuçlarını raporla.

## Kapsam dışı

Bu görevde Google Calendar/OAuth/ICS, backend, hesap sistemi, push bildirimi, AI plan üretimi veya bulut senkronizasyonu ekleme. Bu özellikler sonraki aşamadır.

## Teslim raporu

Agent sonunda şunları belirtmeli:

1. Değiştirilen dosyalar.
2. Eklenen veya değiştirilen route/menu öğeleri.
3. Mobil viewport'ta test edilen akışlar.
4. Çalıştırılan komutlar ve sonuçları.
5. Kalan sorunlar veya sonraki işler.
