import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const outdir = path.resolve('public');
fs.mkdirSync(outdir, { recursive: true });

const css = fs.readFileSync(path.resolve('ui/tokens.css'), 'utf8');
fs.writeFileSync(path.join(outdir, 'tokens.css'), css);

await build({
  entryPoints: ['ui/app.tsx'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  outfile: path.join(outdir, 'app.js'),
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

const appJs = fs.readFileSync(path.join(outdir, 'app.js'));
const version = createHash('sha256').update(appJs).digest('hex').slice(0, 10);

fs.writeFileSync(
  path.join(outdir, 'index.html'),
  `<!doctype html>
<html lang="id" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>STUDIO/OTOMOTIF</title>
    <meta name="description" content="Studio video otomotif dengan tim agen AI" />
    <meta name="theme-color" content="#0A0A0A" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/tokens.css?v=${version}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js?v=${version}"></script>
  </body>
</html>
`,
);

fs.writeFileSync(
  path.join(outdir, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'Studio Otomotif',
      short_name: 'Studio',
      start_url: '/',
      display: 'standalone',
      background_color: '#0A0A0A',
      theme_color: '#0A0A0A',
    },
    null,
    2,
  ),
);

console.log('UI dibangun ke public/');
