// Riset mandiri: cari mobil yang tidak ada di katalog lalu susun data dari
// Wikipedia + Wikimedia Commons. Semua angka berasal dari sumber yang bisa
// dibuka pembaca; field yang tidak ditemukan dibiarkan kosong dan dilaporkan,
// bukan dikarang. Wikipedia mendukung CORS (`origin=*`), jadi ini berjalan di
// situs statis tanpa backend.

import type { Car } from '../data/catalog.ts';

const WIKI = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

export type ResearchPhoto = {
  title: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  license: string;
  author: string;
  pageUrl: string;
};

export type ResearchSource = { label: string; url: string };

export type ResearchResult = {
  /** Mobil siap dipakai pipeline; field kosong berarti tidak ditemukan di sumber. */
  car: Car;
  /** Label field katalog yang tidak bisa dipastikan dari sumber. */
  missing: string[];
  /** Rincian tiap field, supaya UI bisa menandai mana yang terisi. */
  fields: { key: string; label: string; value: string; found: boolean }[];
  photo: ResearchPhoto | null;
  gallery: ResearchPhoto[];
  summary: string;
  sources: ResearchSource[];
  query: string;
  articleTitle: string;
};

export class ResearchError extends Error {}

/* --------------------------------------------------------------- helpers */

const decode = (s: string): string =>
  s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Buang tag, catatan kaki `[1]`, dan spasi berlebih dari potongan HTML. */
export function textOf(html: string): string {
  return decode(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<sup[^>]*class="reference"[\s\S]*?<\/sup>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\[\s*\d+\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ambil pasangan label→nilai dari tabel infobox pertama. */
export function infoboxRows(html: string): Record<string, string> {
  const table = /<table[^>]*class="[^"]*infobox[\s\S]*?<\/table>/i.exec(html);
  const out: Record<string, string> = {};
  if (!table) return out;
  for (const row of table[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const th = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(row);
    const td = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(row);
    if (!th || !td) continue;
    const key = textOf(th[1]).toLowerCase().replace(/\s+/g, ' ').trim();
    const value = textOf(td[1]);
    if (key && value && !(key in out)) out[key] = value;
  }
  return out;
}

const first = (rows: Record<string, string>, keys: string[]): string => {
  for (const k of keys) if (rows[k]) return rows[k];
  return '';
};

/** "652 kW (887 PS; 875 hp)" -> "887 PS" (PS dipakai katalog ini). */
export function normalisePower(raw: string): string {
  if (!raw) return '';
  const ps = /([\d.,]+)\s*PS\b/i.exec(raw);
  if (ps) return `${ps[1]} PS`;
  const kw = /([\d.,]+)\s*kW/i.exec(raw);
  if (kw) {
    const val = Number(kw[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return `${Math.round(val * 1.35962)} PS`;
  }
  const hp = /([\d.,]+)\s*(?:hp|bhp)/i.exec(raw);
  if (hp) {
    const val = Number(hp[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return `${Math.round(val * 1.01387)} PS`;
  }
  return '';
}

/** "740 N·m (546 lb·ft)" -> "740 Nm". */
export function normaliseTorque(raw: string): string {
  if (!raw) return '';
  const nm = /([\d.,]+)\s*N[·.\s]*m\b/i.exec(raw);
  if (nm) return `${nm[1]} Nm`;
  const lb = /([\d.,]+)\s*lb/i.exec(raw);
  if (lb) {
    const val = Number(lb[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return `${Math.round(val * 1.3558)} Nm`;
  }
  return '';
}

/** "1,634–1,720 kg (3,602–3,791 lb)" -> "1,634 kg" (kg dulu, bukan lb). */
export function normaliseWeight(raw: string): string {
  if (!raw) return '';
  const kg = /([\d.,]+)(?:\s*[–-]\s*[\d.,]+)?\s*kg/i.exec(raw);
  if (kg) return `${kg[1]} kg`;
  const lb = /([\d.,]+)\s*lb/i.exec(raw);
  if (lb) {
    const val = Number(lb[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return `${Math.round(val * 0.453592)} kg`;
  }
  return '';
}

/** "September 2013 – June 2015" -> "2013–2015"; tahun tunggal tetap "2015". */
export function normaliseYears(raw: string): string {
  if (!raw) return '';
  const years = [...raw.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => m[0]);
  if (years.length === 0) return '';
  const uniq = Array.from(new Set(years));
  if (uniq.length === 1) return uniq[0];
  return `${uniq[0]}–${uniq[uniq.length - 1]}`;
}

/**
 * Cari 0–100 di prosa artikel. Hanya menerima pola yang eksplisit menyebut
 * 0–100 km/h (atau 0–60 mph) beserta satuannya, supaya angka lain tidak ikut.
 */
export function findAcceleration(text: string): string {
  // Jarak antara satuan dan angka dibatasi ketat: hanya boleh tanda kurung
  // konversi seperti "(0–62 mph)" dan kata "in". Tanpa batas ini, daftar
  // "0–100 km/h, 7.0 seconds for 0–200 km/h" terbaca 7,0 dtk — salah total.
  const kmh =
    /0\s*(?:–|-|to)\s*100\s*km\/h(?:\s*\(0[^)]*\))?\s*(?:in|at|:|=)?\s*([\d]+(?:[.,]\d+)?)\s*(?:seconds|secs?|s)\b/i.exec(
      text,
    );
  if (kmh) return `${kmh[1].replace('.', ',')} dtk`;
  const mph =
    /0\s*(?:–|-|to)\s*60\s*mph(?:\s*\(0[^)]*\))?\s*(?:in|at|:|=)?\s*([\d]+(?:[.,]\d+)?)\s*(?:seconds|secs?|s)\b/i.exec(
      text,
    );
  if (mph) return `${mph[1].replace('.', ',')} dtk`;
  return '';
}

/** Top speed hanya diterima bila kalimatnya menyebut top/maximum speed. */
export function findTopSpeed(text: string): string {
  const m =
    /(?:top speed|maximum speed)\s*(?:of|is|:|=|was)?\s*([\d]{2,3}(?:[.,]\d+)?)\s*(km\/h|mph)/i.exec(text);
  if (!m) return '';
  const val = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(val) || val <= 0) return '';
  const kmh = /km\/h/i.test(m[2]) ? val : Math.round(val * 1.60934);
  return `${Math.round(kmh)} km/jam`;
}

/** Torsi dari prosa, mis. "1,600 N⋅m (1,180 lbf⋅ft) of torque". */
export function findTorqueInProse(text: string): string {
  const m =
    /([\d.,]+)\s*N\s*[⋅·.\s]?\s*m\b[^.]{0,40}?(?:of\s+)?torque/i.exec(text) ??
    /torque\s*(?:of|is|:|=|was)?\s*([\d.,]+)\s*N\s*[⋅·.\s]?\s*m\b/i.exec(text);
  if (!m) return '';
  return `${m[1]} Nm`;
}

/** Tenaga dari prosa bila infobox hanya memberi kW/hp tanpa PS. */
export function findPowerInProse(text: string): string {
  const ps = /([\d.,]+)\s*PS\b[^.]{0,40}?(?:of\s+)?(?:power|output)/i.exec(text);
  if (ps) return `${ps[1]} PS`;
  const kw = /([\d.,]+)\s*kW\b[^.]{0,40}?(?:of\s+)?(?:power|output)/i.exec(text);
  if (kw) {
    const val = Number(kw[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return `${Math.round(val * 1.35962)} PS`;
  }
  return '';
}

/** Berat dari prosa bila infobox tidak punya baris berat. */
export function findWeightInProse(text: string): string {
  const m = /(?:weighs|weight of|kerb weight of|curb weight of)[^.\d]{0,20}?([\d.,]+)\s*kg/i.exec(text);
  return m ? `${m[1]} kg` : '';
}

/* ------------------------------------------------------------------ HTTP */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON dengan retry singkat untuk 429 (Wikipedia membatasi laju anonim). */
async function getJson(url: string, attempt = 0): Promise<any> {
  let res: Response;
  try {
    // Wikipedia menolak permintaan tanpa User-Agent yang jelas (HTTP 403,
    // balasannya halaman HTML). Tanpa header ini pencarian selalu "gagal".
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'StudioAI-Otomotif/1.0 (educational video studio)',
      },
    });
  } catch {
    throw new ResearchError(
      'Tidak bisa menghubungi Wikipedia. Periksa koneksi internet Anda, lalu coba lagi.',
    );
  }
  if (res.status === 429 && attempt < 3) {
    await sleep(1200 * (attempt + 1));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) {
    throw new ResearchError(
      res.status === 429
        ? 'Wikipedia sedang membatasi permintaan. Tunggu beberapa detik lalu coba lagi.'
        : `Wikipedia menolak permintaan (HTTP ${res.status}). Coba lagi nanti.`,
    );
  }
  return res.json();
}

export type SearchHit = { title: string; snippet: string };

/** Cari artikel mobil di Wikipedia (namespace artikel saja). */
export async function searchArticles(query: string, limit = 8): Promise<SearchHit[]> {
  const url = `${WIKI}?action=query&list=search&srsearch=${encodeURIComponent(
    query,
  )}&srlimit=${limit}&srnamespace=0&format=json&origin=*`;
  const data = await getJson(url);
  const hits = (data?.query?.search ?? []) as { title: string; snippet: string }[];
  return hits.map((h) => ({ title: h.title, snippet: textOf(h.snippet) }));
}

async function articleSection0(title: string): Promise<{ html: string; page: string }> {
  const url = `${WIKI}?action=parse&page=${encodeURIComponent(
    title,
  )}&prop=text&section=0&redirects=1&format=json&origin=*`;
  const data = await getJson(url);
  const html = data?.parse?.text?.['*'];
  if (!html) throw new ResearchError(`Artikel "${title}" tidak bisa dibaca.`);
  return { html, page: data.parse.title ?? title };
}

/**
 * Satu permintaan untuk prosa lengkap + daftar berkas gambar. Dulu tiga
 * permintaan terpisah, dan itu memicu HTTP 429 saat pengguna mencoba beberapa
 * model berturut-turut.
 */
async function articleTextAndImages(
  title: string,
): Promise<{ prose: string; lead: string; images: string[] }> {
  const url = `${WIKI}?action=query&prop=extracts|images&explaintext=1&imlimit=24&redirects=1&titles=${encodeURIComponent(
    title,
  )}&format=json&origin=*`;
  const data = await getJson(url);
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0] as
    | { extract?: string; images?: { title: string }[] }
    | undefined;
  const prose = page?.extract ?? '';
  const lead = prose.split(/\n\s*\n/)[0] ?? '';
  return { prose, lead, images: (page?.images ?? []).map((i) => i.title) };
}

const SKIP_IMAGE =
  /(commons-logo|wiki|icon|flag|map|logo|signature|question_book|ambox|edit-|padlock|\.svg$|\.gif$)/i;

/** Foto dari Commons beserta lisensi dan kredit fotografernya. */
async function commonsImages(fileTitles: string[], want = 6): Promise<ResearchPhoto[]> {
  const files = fileTitles.filter((t) => /^File:/i.test(t) && !SKIP_IMAGE.test(t)).slice(0, 14);
  if (files.length === 0) return [];
  const url = `${COMMONS}?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1280&titles=${encodeURIComponent(
    files.join('|'),
  )}`;
  const data = await getJson(url);
  const pages = data?.query?.pages ?? {};
  const out: ResearchPhoto[] = [];
  for (const page of Object.values(pages) as any[]) {
    const info = page?.imageinfo?.[0];
    if (!info?.thumburl) continue;
    const meta = info.extmetadata ?? {};
    out.push({
      title: page.title,
      url: info.url ?? info.thumburl,
      thumbUrl: info.thumburl,
      width: info.width ?? 0,
      height: info.height ?? 0,
      license: textOf(meta.LicenseShortName?.value ?? '') || 'lisensi tidak tercatat',
      author: textOf(meta.Artist?.value ?? '').slice(0, 90) || 'kredit tidak tercatat',
      pageUrl: info.descriptionurl ?? '',
    });
  }
  // Foto lanskap lebih dulu: video 16:9 butuh lebar, bukan tinggi.
  return out
    .sort((a, b) => b.width / Math.max(1, b.height) - a.width / Math.max(1, a.height))
    .slice(0, want);
}

/* -------------------------------------------------------------- assembly */
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Urutan penting: mobil jalan raya harus menang atas kata "motorsport" yang
// sering muncul di ringkasan hypercar. Balap butuh sinyal kuat (kelas lomba).
const CATEGORY_RULES: Array<{ match: RegExp; kategori: string }> = [
  { match: /(formula one|formula e|racing car|race car|rally car|gt3|gt4|le mans|stock car|group b|touring car)/i, kategori: 'balap' },
  // "custom"/"modified" muncul di deskripsi mobil biasa, jadi jangan dipakai.
  { match: /(\btuned\b|\btuning\b|widebody|body kit|aftermarket)/i, kategori: 'modifikasi' },
  { match: /(sports car|supercar|hypercar|muscle car|roadster|coupé|coupe|grand tourer)/i, kategori: 'sport' },
  { match: /(classic|vintage|antique)/i, kategori: 'klasik' },
];

export function guessCategory(text: string, year: string): string {
  for (const rule of CATEGORY_RULES) if (rule.match.test(text)) return rule.kategori;
  const start = Number((/\b(?:19|20)\d{2}\b/.exec(year) ?? [''])[0]);
  if (Number.isFinite(start) && start > 0 && start < 1980) return 'klasik';
  return 'sport';
}

const BRANDS = [
  'Ferrari', 'Lamborghini', 'Porsche', 'Nissan', 'Toyota', 'Honda', 'Mazda', 'Subaru',
  'Mitsubishi', 'BMW', 'Mercedes-Benz', 'Mercedes', 'Audi', 'Volkswagen', 'Bugatti',
  'Koenigsegg', 'Pagani', 'McLaren', 'Aston Martin', 'Jaguar', 'Lotus', 'Alfa Romeo',
  'Ford', 'Chevrolet', 'Dodge', 'Tesla', 'Rimac', 'Pininfarina', 'Bentley', 'Rolls-Royce',
  'Peugeot', 'Renault', 'Citroën', 'Volvo', 'Polestar', 'Suzuki', 'Daihatsu', 'Hyundai',
  'Kia', 'Genesis', 'Lexus', 'Infiniti', 'Acura', 'Cadillac', 'Jeep', 'Land Rover',
  'Mini', 'Fiat', 'Abarth', 'Maserati', 'Bizzarrini', 'Singer', 'Ruf', 'Saleen',
  'Hennessey', 'Czinger', 'Lucid', 'Nio', 'BYD', 'Wuling', 'Isuzu', 'Datsun', 'Triumph',
];

export function guessBrand(title: string, manufacturer: string): string {
  const hay = `${title} ${manufacturer}`;
  for (const brand of BRANDS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(hay)) return brand;
  }
  return (title.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{N}-]/gu, '');
}

/** Jenis penggerak yang disebut sebuah frasa, untuk mendeteksi duplikat. */
function driveKind(part: string): string {
  const p = part.toLowerCase();
  if (/(four-wheel|4wd|all-wheel|awd)/.test(p)) return 'awd';
  if (/(rear-wheel|rwd)/.test(p)) return 'rwd';
  if (/(front-wheel|fwd)/.test(p)) return 'fwd';
  return '';
}

/**
 * Buang pengulangan dalam satu nilai infobox, mis.
 * "Mid-engine, four-wheel-drive layout, All-wheel drive vehicle" — ketiga
 * bagian menyebut hal yang sama dan tampil berlebihan di panel riset.
 */
export function dedupePhrases(value: string): string {
  if (!value) return '';
  const parts = value
    .split(/\s*[,;]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  const kinds = new Set<string>();
  for (const part of parts) {
    const kind = driveKind(part);
    if (kind && kinds.has(kind)) continue;
    if (kind) kinds.add(kind);
    const key = part.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (out.some((o) => o.toLowerCase().replace(/[^a-z0-9]/g, '') === key)) continue;
    out.push(part);
  }
  return out.join(', ');
}

/**
 * Tagline berbahasa Indonesia dari angka yang tersedia. Tanpa nama model:
 * `buildBrief` sudah menambahkan nama di depannya, jadi menaruhnya di sini
 * menghasilkan "Bugatti Chiron: Bugatti Chiron: ...".
 */
export function taglineFrom(spec: {
  model: string;
  engine: string;
  power: string;
  torque: string;
  nol100: string;
  vmax: string;
}): string {
  const bits: string[] = [];
  if (spec.power) bits.push(spec.power);
  if (spec.nol100) bits.push(`0–100 ${spec.nol100}`);
  if (spec.vmax) bits.push(`puncak ${spec.vmax}`);
  if (bits.length > 0) return `${bits.join(' · ')}.`;
  if (spec.engine) return `Mesin ${spec.engine.split(',')[0].trim()}.`;
  return 'Data diambil dari Wikipedia.';
}

/** Susun `Car` dari HTML infobox + prosa. Field yang tidak ada dibiarkan kosong. */
export function buildCarFromArticle(input: {
  title: string;
  html: string;
  prose: string;
  summary: string;
}): { car: Car; fields: ResearchResult['fields']; missing: string[] } {
  const rows = infoboxRows(input.html);
  const prose = `${input.summary} ${input.prose}`;

  const manufacturer = first(rows, ['manufacturer', 'manufacturers', 'brand', 'maker']);
  const production = first(rows, ['production', 'model years', 'years', 'model year']);
  const engine = first(rows, [
    'engine',
    'engines',
    'powerplant',
    'engine type',
    'electric motor',
    'motors',
    'motor',
  ]);
  const power =
    normalisePower(first(rows, ['power output', 'power', 'engine power', 'max power', 'output'])) ||
    findPowerInProse(prose);
  const torque =
    normaliseTorque(first(rows, ['torque', 'maximum torque', 'max torque'])) ||
    findTorqueInProse(prose);
  const weight =
    normaliseWeight(first(rows, ['curb weight', 'kerb weight', 'weight', 'dry weight'])) ||
    findWeightInProse(prose);
  // "Mid-engine, four-wheel-drive layout, All-wheel drive vehicle" -> buang
  // pengulangan agar tidak tampil dua kali di panel.
  const layout = dedupePhrases(first(rows, ['layout', 'drivetrain', 'drive', 'powertrain']));
  const years = normaliseYears(production);
  const bodyStyle = first(rows, ['body style', 'class', 'car body style']);

  const model = input.title.replace(/\s*\(.*?\)\s*$/, '').trim();
  const nol100 = findAcceleration(prose);
  const vmax = findTopSpeed(prose);
  const car: Car = {
    slug: slugify(model) || 'model-riset',
    merk: guessBrand(input.title, manufacturer),
    model,
    // Generasi/varian tidak bisa dipastikan dari infobox, jadi dikosongkan
    // daripada menyalin tanggal produksi yang bukan nama seri.
    seri: '',
    tahun: years,
    kategori: guessCategory(`${bodyStyle} ${input.summary} ${input.title}`, years),
    mesin: engine,
    tenaga: power,
    torsi: torque,
    layout,
    berat: weight,
    nol100,
    vmax,
    // Tagline disusun dari angka yang benar-benar ada, bukan kutipan Inggris
    // panjang — seluruh antarmuka studio memakai bahasa Indonesia.
    tagline: taglineFrom({ model, engine, power, torque, nol100, vmax }),
    deskripsi: (input.summary || '').slice(0, 400),
    sumber: `https://en.wikipedia.org/wiki/${encodeURIComponent(input.title.replace(/ /g, '_'))}`,
  };

  const fields = [
    { key: 'mesin', label: 'Mesin', value: car.mesin },
    { key: 'tenaga', label: 'Tenaga', value: car.tenaga },
    { key: 'torsi', label: 'Torsi', value: car.torsi },
    { key: 'berat', label: 'Berat', value: car.berat },
    { key: 'layout', label: 'Layout', value: car.layout },
    { key: 'nol100', label: '0–100', value: car.nol100 },
    { key: 'vmax', label: 'Top speed', value: car.vmax },
    { key: 'tahun', label: 'Tahun', value: car.tahun },
  ].map((f) => ({ ...f, found: f.value.trim().length > 0 }));

  return { car, fields, missing: fields.filter((f) => !f.found).map((f) => f.label) };
}

/** Cari satu mobil secara mandiri: artikel terbaik, spesifikasi, dan foto. */
export async function researchCar(query: string): Promise<ResearchResult> {
  const q = query.trim();
  if (q.length < 2) throw new ResearchError('Tulis minimal dua huruf, misalnya "Porsche 918".');

  const hits = await searchArticles(q);
  if (hits.length === 0) {
    throw new ResearchError(`Tidak ada artikel Wikipedia yang cocok dengan "${q}".`);
  }

  // Utamakan hasil yang ringkasannya benar-benar menyebut mobil.
  let chosen = hits[0];
  for (const hit of hits.slice(0, 5)) {
    if (/(car|automobile|vehicle|sports|supercar|hypercar|coupé|coupe|sedan|hatchback|SUV|roadster)/i.test(hit.snippet)) {
      chosen = hit;
      break;
    }
  }

  const { html, page } = await articleSection0(chosen.title);
  const { prose, lead, images } = await articleTextAndImages(page);
  const { car, fields, missing } = buildCarFromArticle({
    title: page,
    html,
    prose,
    summary: lead,
  });

  if (fields.every((f) => !f.found)) {
    throw new ResearchError(
      `Artikel "${page}" tidak memuat data spesifikasi. Coba tulis model lebih lengkap.`,
    );
  }

  const gallery = await commonsImages(images, 6);
  const photo = gallery[0] ?? null;

  const sources: ResearchSource[] = [
    { label: `Wikipedia — ${page}`, url: car.sumber },
    ...(photo
      ? [{ label: `Foto: ${photo.title.replace(/^File:/, '')} (${photo.license})`, url: photo.pageUrl }]
      : []),
  ];

  return {
    car,
    missing,
    fields,
    photo,
    gallery,
    summary: lead,
    sources,
    query: q,
    articleTitle: page,
  };
}

/* ------------------------------------------------- pencarian lintas internet */

export type KandidatWeb = {
  /** Judul artikel Wikipedia; dipakai `researchCar` saat kandidat dipilih. */
  judul: string;
  nama: string;
  tahun: string;
  tenaga: string;
  deskripsi: string;
  gambarUrl: string;
  halamanUrl: string;
};

const KATA_UMUM = new Set(['car', 'cars', 'the', 'and', 'of', 'for']);

function kataKunci(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((k) => k.length > 1 && !KATA_UMUM.has(k));
}

/** Ambil satu nilai dari wikitext infobox, termasuk templat bersarang. */
function nilaiInfobox(wikitext: string, kunci: string): string {
  const pola = new RegExp(`\\|\\s*${kunci}\\s*=\\s*`, 'i');
  const m = pola.exec(wikitext);
  if (!m) return '';
  let i = m.index + m[0].length;
  let dalam = 0;
  let hasil = '';
  while (i < wikitext.length) {
    const dua = wikitext.slice(i, i + 2);
    if (dua === '{{') { dalam += 1; hasil += dua; i += 2; continue; }
    if (dua === '}}') {
      if (dalam === 0) break;
      dalam -= 1; hasil += dua; i += 2; continue;
    }
    if (wikitext[i] === '\n' && dalam === 0) break;
    hasil += wikitext[i];
    i += 1;
  }
  return hasil.trim();
}

/** Ubah nilai wikitext jadi teks yang enak dibaca; tidak mengarang isi. */
export function rapikanWikitext(teks: string): string {
  if (!teks) return '';
  let hasil = teks;

  // {{engine size|bore=..|stroke=..|cyl=..}} dihitung dari ukuran nyata.
  hasil = hasil.replace(/\{\{\s*engine size\s*\|([^{}]*)\}\}/gi, (_m, args: string) => {
    const p: Record<string, string> = {};
    for (const bagian of args.split('|')) {
      const [k, v] = bagian.split('=');
      if (k && v) p[k.trim().toLowerCase()] = v.trim();
    }
    const bore = Number(p.bore);
    const stroke = Number(p.stroke);
    const cyl = Number(p.cyl);
    if (!bore || !stroke || !cyl) return '';
    const mm3 = (Math.PI / 4) * bore * bore * stroke * cyl;
    const skala = Number(p.scale ?? 1) || 1;
    return (mm3 / skala).toFixed(Number(p.rnd ?? 0));
  });

  for (let i = 0; i < 4; i += 1) {
    const sebelum = hasil;
    hasil = hasil.replace(
      /\{\{\s*(convert|cvt)\s*\|([^|{}]*)\|([^|{}\s]+)([^{}]*)\}\}/gi,
      (_m, _t, angka: string, unit: string, sisa: string) => {
        const keluaran = /order\s*=\s*out/i.test(sisa)
          ? (sisa.match(/\|\s*([a-z]+)/i)?.[1] ?? unit)
          : unit;
        const nilai = Number(angka);
        if (Number.isFinite(nilai) && /^l$/i.test(unit) && /^cc/i.test(keluaran)) {
          return `${Math.round(nilai * 1000)} cc`;
        }
        return `${angka} ${unit}`;
      },
    );
    if (hasil === sebelum) break;
  }

  return hasil
    // Catatan kaki dan tag HTML harus dibuang sebelum sisanya dirapikan.
    .replace(/<ref[^>]*\/>/gi, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Wikipedia berbahasa Inggris; tahun "present" berarti masih diproduksi.
    .replace(/\bpresent\b/gi, 'sekarang')
    .replace(/&minus;/g, '–')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{\s*(unbulleted list|ubl|plainlist|flatlist|collapsible list)\s*\|?/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/&nbsp;/g, ' ')
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/\{\{|\}\}/g, ' ')
    .replace(/\b(abbr|order|disp|round|adj|sigfig|sp|us|first|out|frac|scale|rnd)\s*=\s*[\w-]*/gi, '')
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/(^|\s)·(\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([–—])/g, '$1')
    .replace(/([–—])\s+/g, '$1')
    .replace(/^[\s·,;/]+|[\s·,;/]+$/g, '')
    .replace(/^[a-z_]+\s*=\s*/i, '')
    .trim();
}

/** Halaman ini benar-benar tentang sebuah mobil, bukan orang atau perusahaan. */
function layakMobil(judul: string, deskripsi: string, gambarUrl: string): boolean {
  if (!gambarUrl) return false;
  // Logo dan diagram SVG bukan foto kendaraan.
  if (/\.svg(\?|$)/i.test(gambarUrl)) return false;
  if (deskripsi.length < 40) return false;
  // Halaman acara dan komponen, bukan model: "Geneva International Motor
  // Show", "Dual-clutch transmission".
  if (/\b(motor show|auto show|salon|transmission|engine|platform|chassis|tyre|tire|wheel)\b/i.test(judul)) {
    return false;
  }
  // Halaman konsep umum, bukan model: "Automobile drag coefficient".
  if (/^(automobile|car|cars|vehicle|list of|history of|automotive|glossary)\b/i.test(judul.trim())) {
    return false;
  }
  // Tokoh: "Christian von Koenigsegg" muncul saat mencari "Koenigsegg Jesko".
  if (/\b(born\s+\d|businessman|businesswoman|entrepreneur|he founded|she founded)\b/i.test(deskripsi)) {
    return false;
  }
  // Perusahaan/produsen, bukan model.
  if (/\b(automobiles?|motors?|company|manufacturer|ag|gmbh|inc\.?|ltd\.?)\s*$/i.test(judul.trim())) {
    return false;
  }
  if (/\b(in motorsport|DTM|Formula One|racing team)\b/i.test(judul)) return false;
  // Halaman teknis ("Dihedral synchro-helix actuation doors") punya foto dan
  // menyebut "car", tapi judulnya bukan nama model. Model selalu diawali
  // mereknya, dan merek itu muncul di kata pertama judul.
  if (/\b(doors?|actuation|suspension|brake|gearbox|aerodynamics?|technology)\b/i.test(judul)) {
    return false;
  }
  // Tanpa "\b" di ujung: huruf beraksen ("coupé") bukan \w di JS.
  return /\b(car|automobile|vehicle|supercar|hypercar|roadster|coup|sedan|hatchback|convertible)/i.test(deskripsi);
}

/** Skor judul: judul persis selalu menang atas model lain yang mirip. */
export function skorJudulWeb(judul: string, query: string): number {
  const kata = kataKunci(query);
  if (!kata.length) return 0;
  const j = judul.toLowerCase().trim();
  if (j === query.toLowerCase().trim()) return 1;
  const cocok = kata.filter((k) => j.includes(k)).length;
  const dasar = cocok / kata.length;
  const awalan = j.startsWith(kata[0]) ? 0.15 : 0;
  const tambahan = Math.max(0, j.split(/\s+/).filter(Boolean).length - kata.length);
  return Math.min(1, Math.max(0, dasar + awalan - 0.18 * tambahan)) * 0.85;
}

/**
 * Mencari banyak mobil sekaligus di internet.
 *
 * Satu permintaan `generator=search` mengembalikan deskripsi, gambar, dan
 * wikitext sekaligus. Dulu tiap kandidat butuh beberapa permintaan, dan itu
 * memicu HTTP 429. Spesifikasi lengkap tetap disusun `researchCar` saat
 * kandidat dipilih.
 */
/** Kueri cadangan: buang kode generasi ("MK5", "R34") yang tidak ada di Wikipedia. */
export function varianKueriWeb(q: string): string[] {
  const hasil: string[] = [];
  const tanpaKode = q.replace(/\b(mk|generation|gen)\s*[ivx\d]+\b/gi, '').replace(/\s+/g, ' ').trim();
  if (tanpaKode && tanpaKode !== q) hasil.push(tanpaKode);
  // Buang kata terakhir satu per satu: "Toyota Supra MK5" -> "Toyota Supra".
  let potong = q;
  while (potong.includes(' ') && hasil.length < 3) {
    potong = potong.replace(/\s+\S+$/, '');
    if (potong.length >= 4 && !hasil.includes(potong)) hasil.push(potong);
  }
  return hasil;
}

export async function cariMobilWeb(query: string, limit = 8): Promise<KandidatWeb[]> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 2) return [];

  // Kata kunci asli dicoba lebih dulu; cadangan hanya dipakai bila kosong.
  for (const percobaan of [q, ...varianKueriWeb(q)]) {
    const hasil = await cariSekali(percobaan, limit);
    if (hasil.length) return hasil;
  }
  return [];
}

async function cariSekali(q: string, limit: number): Promise<KandidatWeb[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: q,
    gsrlimit: String(Math.min(limit * 2, 20)),
    prop: 'extracts|pageimages|revisions',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    piprop: 'original',
    rvprop: 'content',
    rvslots: 'main',
  });
  const data = await getJson(`${WIKI}?${params}`);
  const pages = Object.values((data?.query?.pages ?? {}) as Record<string, any>);

  const kandidat: (KandidatWeb & { skor: number })[] = [];
  for (const page of pages) {
    const judul = String(page.title ?? '');
    const deskripsi = String(page.extract ?? '').trim();
    const gambarUrl = page.original?.source ?? '';
    if (!layakMobil(judul, deskripsi, gambarUrl)) continue;

    const wikitext = page.revisions?.[0]?.slots?.main?.['*'] ?? '';
    // Tahun produksi sering berisi daftar semua varian; kartu hanya butuh
    // rentang pertama, sisanya merusak tata letak.
    const tahunPenuh = rapikanWikitext(
      nilaiInfobox(wikitext, 'production') || nilaiInfobox(wikitext, 'model_years'),
    );
    const tahun = tahunPenuh.length > 40 ? `${tahunPenuh.slice(0, 38).trimEnd()}…` : tahunPenuh;
    const tenaga = rapikanWikitext(
      nilaiInfobox(wikitext, 'powerout') ||
        nilaiInfobox(wikitext, 'power') ||
        nilaiInfobox(wikitext, 'output'),
    );

    // Tanpa satu kata pun yang sama, halaman ini bukan yang dicari: mencari
    // "Rimac Nevera" tidak boleh menampilkan "Koenigsegg Regera".
    const skor = skorJudulWeb(judul, q);
    if (skor <= 0) continue;

    kandidat.push({
      judul,
      nama: judul,
      tahun,
      tenaga,
      deskripsi,
      gambarUrl,
      halamanUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(judul.replace(/ /g, '_'))}`,
      skor,
    });
  }

  return kandidat
    .sort((a, b) => b.skor - a.skor)
    .slice(0, limit)
    .map(({ skor: _skor, ...sisa }) => sisa);
}
