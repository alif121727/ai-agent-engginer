// Hasilkan data template mobil untuk studio: studio/src/data/car-templates.json
// (dibundel ke UI) dan netlify-site/car-templates.json (dibaca runtime oleh
// backend yang menyajikan public/). Sumbernya tetap templates/cars/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { listCarTemplates } from '../src/core/car-templates.ts';
import { paths } from '../src/core/fsx.ts';

const items = listCarTemplates();
const payload = { total: items.length, hasil: items };

// Satu target saja: JSON ini diimpor bundel, jadi tidak perlu salinan runtime.
const targets = [path.join(paths.root, 'studio', 'src', 'data', 'car-templates.json')];

for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, JSON.stringify(payload, null, 2) + '\n');
}

console.log(`✓ ${items.length} template mobil -> ${targets.map((t) => path.relative(paths.root, t)).join(', ')}`);
