// Build studio -> netlify-site/ (index.html + assets/*).
// Video & thumb tidak disentuh di sini; keduanya ikut git karena Netlify
// membangun dari checkout bersih.
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'studio');
const out = path.join(root, 'netlify-site');
const assets = path.join(out, 'assets');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.mkdirSync(assets, { recursive: true });

// Gagal keras kalau media tidak ada: Netlify mempertahankan deploy sukses
// terakhir, jadi build gagal jauh lebih baik daripada menerbitkan galeri kosong.
const required = ['video', 'thumb'];
const missing = required.filter((d) => {
  const p = path.join(out, d);
  return !fs.existsSync(p) || fs.readdirSync(p).length === 0;
});
if (missing.length > 0) {
  console.error(`Media hilang dari checkout: ${missing.join(', ')} di netlify-site/`);
  process.exit(1);
}

// Hash isi media dihitung sebelum bundel dibangun, karena nilainya disuntik ke
// dalam JS. Tanpa ini URL mp4 tidak berubah saat berkasnya diganti, jadi
// browser terus memutar audio lama dari cache — persis bug suara mesin.
const mediaDir = path.join(out, 'video');
const mediaHash = crypto
  .createHash('sha1')
  .update(
    fs
      .readdirSync(mediaDir)
      .sort()
      .map((f) => {
        const st = fs.statSync(path.join(mediaDir, f));
        return `${f}:${st.size}:${Math.round(st.mtimeMs)}`;
      })
      .join('|'),
  )
  .digest('hex')
  .slice(0, 8);

const res = await build({
  entryPoints: [path.join(src, 'src/main.tsx')],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.css': 'css' },
  outfile: path.join(assets, 'studio.js'),
  metafile: true,
  logLevel: 'warning',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __MEDIA_VERSION__: JSON.stringify(mediaHash),
  },
});

// esbuild menaruh CSS hasil impor di file .css terpisah
const cssOut = path.join(assets, 'studio.css');
if (!fs.existsSync(cssOut)) {
  console.error('CSS tidak dihasilkan esbuild');
  process.exit(1);
}

const oldIndex = path.join(out, 'index.html');
fs.copyFileSync(path.join(src, 'index.html'), oldIndex);
// 404.html statis: dipakai Netlify dan GitHub Pages apa adanya.
fs.copyFileSync(path.join(src, '404.html'), path.join(out, '404.html'));

const js = fs.statSync(path.join(assets, 'studio.js')).size;
const css = fs.statSync(cssOut).size;

// Sisipkan hash isi ke index.html supaya cache-busting otomatis dan
// deploy baru langsung terlihat walau CDN masih menyimpan versi lama.
const hash = crypto
  .createHash('sha1')
  .update(fs.readFileSync(path.join(assets, 'studio.js')))
  .update(fs.readFileSync(cssOut))
  .digest('hex')
  .slice(0, 8);
const idxPath = path.join(out, 'index.html');
const html = fs.readFileSync(idxPath, 'utf8')
  .replace('assets/studio.css', `assets/studio.css?v=${hash}`)
  .replace('assets/studio.js', `assets/studio.js?v=${hash}`)
  .replaceAll('__APP_VERSION__', pkg.version);
fs.writeFileSync(idxPath, html);

console.log(`✓ studio dibangun: studio.js ${(js / 1024).toFixed(0)} kB, studio.css ${(css / 1024).toFixed(1)} kB, v=${hash}, media=${mediaHash}`);
