'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.capacitor', 'mobile');

const files = [
  ['src/mobile.html', 'index.html'],
  ['src/styles/mobile.css', 'styles/mobile.css'],
  ['src/js/mobile-domain.js', 'js/mobile-domain.js'],
  ['src/js/mobile-repository.js', 'js/mobile-repository.js'],
  ['src/js/mobile.js', 'js/mobile.js'],
  ['src/assets/icon.png', 'assets/icon.png']
];

fs.rmSync(out, { recursive: true, force: true });
for (const pair of files) {
  const source = path.join(root, pair[0]);
  const target = path.join(out, pair[1]);
  if (!fs.existsSync(source)) {
    throw new Error('Mobil build girdisi bulunamadı: ' + pair[0]);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
if (!index.includes('mobile-domain.js') || !index.includes('bottom-nav')) {
  throw new Error('Mobil entrypoint doğrulaması başarısız.');
}

console.log('Mobil web çıktısı hazır: ' + path.relative(root, out));
