// Build studio -> netlify-site/ (index.html + assets/*).
// Video & thumb tidak disentuh di sini; keduanya ikut git karena Netlify
// membangun dari checkout bersih.
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LINKS } from '../studio/src/links.ts';

const root = process.cwd();
const src = path.join(root, 'studio');
const out = path.join(root, 'netlify-site');
const assets = path.join(out, 'assets');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.mkdirSync(assets, { recursive: true });

// Gagal keras kalau media tidak ada: Netlify mempertahankan deploy sukses
// terakhir, jadi build gagal jauh lebih baik daripada menerbitkan galeri kosong.
// Server container tidak menyajikan galeri statis itu (159 MB), jadi build di
// sana melewati pemeriksaan ini lewat MEDIA_OPTIONAL=1.
const mediaOptional = process.env.MEDIA_OPTIONAL === '1';
const required = ['video', 'thumb'];
const missing = required.filter((d) => {
  const p = path.join(out, d);
  return !fs.existsSync(p) || fs.readdirSync(p).length === 0;
});
if (missing.length > 0 && !mediaOptional) {
  console.error(`Media hilang dari checkout: ${missing.join(', ')} di netlify-site/`);
  process.exit(1);
}

// Hash isi media dihitung sebelum bundel dibangun, karena nilainya disuntik ke
// dalam JS. Tanpa ini URL mp4 tidak berubah saat berkasnya diganti, jadi
// browser terus memutar audio lama dari cache — persis bug suara mesin.
const mediaDir = path.join(out, 'video');
let mediaHash = 'server';
if (fs.existsSync(mediaDir)) {
  mediaHash = crypto
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
}

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
    __STUDIO_URL__: JSON.stringify(process.env.STUDIO_URL ?? ''),
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
// Pendaftar service worker dipisah dari index.html: CSP `script-src 'self'`
// memblokir skrip inline, sehingga PWA shell tidak pernah aktif.
fs.copyFileSync(path.join(src, 'sw-register.js'), path.join(out, 'sw-register.js'));
// 404.html statis: dipakai Netlify dan GitHub Pages apa adanya.
fs.copyFileSync(path.join(src, '404.html'), path.join(out, '404.html'));
// tautan.html sengaja tanpa JS: alamat studio tetap terbaca walau bundel gagal.
// Alamatnya masih berupa placeholder di sumber, jadi diisi di sini memakai
// STUDIO_URL yang sama dengan bundel; tanpa penggantian halaman ini akan
// menampilkan tautan mati.
// Tanpa env, pakai alamat yang sama dengan default bundel supaya halaman
// tautan tidak pernah menampilkan href kosong.
const studioUrl = process.env.STUDIO_URL ?? LINKS.studio;
const fillStudioUrl = (dir: string, file: string) => {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return;
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('__STUDIO_URL__', studioUrl));
};
fs.copyFileSync(path.join(src, 'tautan.html'), path.join(out, 'tautan.html'));
fillStudioUrl(out, 'tautan.html');

// Salinan untuk backend: `npm run api` menyajikan public/, dan studio memilih
// HttpStudioApi saat /api/health terjawab. Tanpa salinan ini studio hanya
// tersedia sebagai mode demo statis, sehingga "Buat Video" tidak pernah
// menghasilkan mp4. Media tidak disalin (159 MB); server.ts memasang
// netlify-site/video dan /thumb sebagai static mount.
const pub = path.join(root, 'public');
fs.mkdirSync(path.join(pub, 'assets'), { recursive: true });
for (const f of ['studio.js', 'studio.css']) {
  fs.copyFileSync(path.join(assets, f), path.join(pub, 'assets', f));
}
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
fs.copyFileSync(idxPath, path.join(pub, 'index.html'));
fs.copyFileSync(path.join(src, 'sw-register.js'), path.join(pub, 'sw-register.js'));
/**
 * Berkas PWA dan SEO harus ikut ke public/. Tanpa ini `/sw.js` jatuh ke
 * catch-all index.html dan dikirim sebagai `text/html`, sehingga pendaftaran
 * service worker selalu gagal karena MIME salah; manifest dan sitemap juga 404.
 */
for (const f of ['sw.js', 'manifest.json', 'robots.txt', 'sitemap.xml', '404.html']) {
  const from = path.join(out, f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(pub, f));
}
// Ikon PWA dipakai sw.js saat install (SHELL_FILES). Tanpa ini addAll gagal
// dan service worker tidak pernah aktif, jadi manifest pun menunjuk 404.
if (fs.existsSync(path.join(out, 'ikon'))) {
  fs.cpSync(path.join(out, 'ikon'), path.join(pub, 'ikon'), { recursive: true });
}
// Server menyajikan public/ dan catch-all-nya mengirim index.html untuk path
// tak dikenal, jadi tautan.html harus ikut disalin ke sini.
fs.copyFileSync(path.join(src, 'tautan.html'), path.join(pub, 'tautan.html'));
fillStudioUrl(pub, 'tautan.html');

console.log(`✓ studio dibangun: studio.js ${(js / 1024).toFixed(0)} kB, studio.css ${(css / 1024).toFixed(1)} kB, v=${hash}, media=${mediaHash}`);
