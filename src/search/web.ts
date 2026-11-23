/**
 * Pencarian mobil lewat internet.
 *
 * Sumbernya Wikipedia bahasa Inggris, karena tidak butuh kunci API, isinya
 * bisa diverifikasi, dan gambarnya berlisensi bebas. Wikidata tidak dipakai
 * untuk spesifikasi: entitas mobil di sana sering hanya punya delapan
 * properti dan tidak memuat mesin maupun tenaga.
 *
 * Dua API Wikipedia berbeda sifatnya, dan keduanya dibutuhkan:
 * - `list=search` mencocokkan isi artikel, jadi tahan terhadap urutan kata
 *   ("Porsche 911 GT3 RS" tetap menemukan artikelnya).
 * - `opensearch` mencocokkan awalan judul, jadi lebih tepat untuk judul yang
 *   memang persis ("Honda Civic Type R").
 * Menggabungkan keduanya menutup kelemahan masing-masing.
 *
 * Prinsip yang dipegang: **tidak mengarang**. Kolom yang tidak ditemukan
 * dibiarkan kosong. Lebih baik kartu tanpa tenaga mesin daripada kartu
 * dengan tenaga karangan yang akhirnya masuk ke video.
 */

export interface HasilMobil {
  id: string;
  nama: string;
  merk: string;
  tahun: string;
  generasi: string;
  mesin: string;
  transmisi: string;
  tenaga: string;
  deskripsi: string;
  gambarUrl: string;
  halamanUrl: string;
  sumber: 'internet';
}

export interface HasilPencarian {
  hasil: HasilMobil[];
  /** Alasan bila kosong, supaya UI bisa membedakan "tidak ada" dari "gagal". */
  catatan?: string;
}

const UA = 'StudioAI-Otomotif/1.0 (pencarian mobil)';
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Merek yang dikenal, dipakai memisahkan merk dari nama model. */
const MEREK = [
  'Toyota', 'Nissan', 'Honda', 'Mazda', 'Subaru', 'Mitsubishi', 'Suzuki', 'Daihatsu',
  'Isuzu', 'Lexus', 'Infiniti', 'Acura', 'BMW', 'Mercedes-Benz', 'Mercedes-AMG',
  'Mercedes', 'AMG', 'Audi', 'Porsche', 'Volkswagen', 'VW', 'Ferrari', 'Lamborghini',
  'Maserati', 'Pagani', 'Bugatti', 'Koenigsegg', 'Alfa Romeo', 'Fiat', 'Lancia',
  'Abarth', 'Ford', 'Chevrolet', 'Dodge', 'Jeep', 'Tesla', 'Cadillac', 'Buick',
  'Chrysler', 'Aston Martin', 'Bentley', 'Rolls-Royce', 'Jaguar', 'Land Rover',
  'Mini', 'Lotus', 'McLaren', 'Peugeot', 'Renault', 'Citroen', 'Citroën', 'Skoda',
  'Škoda', 'Seat', 'Volvo', 'Saab', 'Opel', 'Hyundai', 'Kia', 'Genesis', 'Chery',
  'Geely', 'BYD', 'Wuling', 'MG', 'GWM', 'Haval', 'Dacia', 'Smart', 'Rimac',
  'Pininfarina', 'Hino', 'Scion', 'Pontiac', 'Plymouth', 'Shelby', 'Ruf',
];

/**
 * Halaman yang bukan satu model mobil.
 *
 * Tanpa penyaring ini, pencarian "Toyota Supra" memunculkan "Toyota Supra in
 * motorsport" dan halaman mesin, lalu spesifikasinya tercampur antar-model.
 */
const BUKAN_MODEL = [
  'disambiguation', 'list of', 'category:', 'template:', 'file:', 'motorsport',
  'championship', 'season', 'video game', 'film)', 'song', 'album',
  'dtm', 'tcr', 'concept', 'safety car', 'pace car', 'engine', 'transmission',
  'platform', 'manufacturer', 'brand',
];

/** Kata yang terlalu umum untuk dijadikan bukti kecocokan judul. */
const KATA_UMUM = new Set(['the', 'and', 'for', 'car', 'cars', 'series', 'model']);

export function merkDari(teks: string): string {
  const t = teks.toLowerCase();
  const cocok = MEREK.filter((m) => t.includes(m.toLowerCase()));
  // Yang paling panjang menang supaya "Mercedes-Benz" tidak jadi "Mercedes".
  return cocok.sort((a, b) => b.length - a.length)[0] ?? '';
}

/** Membersihkan sisa markup wiki dari teks yang akan ditampilkan. */
export function bersihkanTeks(teks: string): string {
  return teks
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/\{\{cite[^}]*\}\}/gi, '')
    .replace(/'{2,}/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mengambil nilai infobox, termasuk yang isinya daftar bertingkat.
 *
 * Infobox memakai `{{unbulleted list|...}}` untuk mesin dan transmisi, jadi
 * pola "satu baris setelah tanda =" tidak cukup. Fungsi ini membaca sampai
 * kurung kurawal seimbang.
 */
export function ambilInfobox(wikitext: string, kunci: string): string {
  const pola = new RegExp(`\\|\\s*${kunci}\\s*=\\s*`, 'i');
  const m = pola.exec(wikitext);
  if (!m) return '';
  let i = m.index + m[0].length;
  let kedalaman = 0;
  let hasil = '';
  while (i < wikitext.length) {
    const dua = wikitext.slice(i, i + 2);
    // Kurung kurawal disalin apa adanya: nilainya sering berupa templat
    // {{convert|700|PS|...}} yang harus tetap utuh agar bisa dirapikan.
    if (dua === '{{') {
      kedalaman += 1;
      hasil += dua;
      i += 2;
      continue;
    }
    if (dua === '}}') {
      kedalaman -= 1;
      hasil += dua;
      i += 2;
      // Jangan berhenti di kurung penutup: satu nilai bisa memuat beberapa
      // templat ("{{convert|185|PS}} and {{convert|160|Nm}}"), dan berhenti
      // di yang pertama membuang separuh isinya.
      continue;
    }
    if (wikitext[i] === '\n' && kedalaman === 0) break;
    hasil += wikitext[i];
    i += 1;
  }
  return bersihkanTeks(hasil);
}

/**
 * Merapikan nilai infobox agar terbaca manusia.
 *
 * Contoh nyata yang harus lolos: `{{convert|1595|cc|L|1|abbr=on|order=flip}}`
 * menjadi "1595 cc", dan `[[BMW N55#S55|S55]]` menjadi "S55".
 */
export function rapikanNilai(teks: string): string {
  if (!teks) return '';
  let hasil = teks;

  // {{engine size|bore=92|stroke=95.25|cyl=8|scale=1000000|rnd=3}} menghitung
  // isi silinder dari ukuran nyata. Tanpa ini, templat bersarang membuat
  // seluruh nilai convert dibuang dan mesin kehilangan kapasitasnya.
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
    // Isi silinder dalam mm³: (π/4) × bore² × stroke × jumlah silinder.
    // `scale` membagi hasilnya ke satuan keluaran (1e6 = liter), jadi harus
    // dibagi, bukan dikali.
    const mm3 = (Math.PI / 4) * bore * bore * stroke * cyl;
    const skala = Number(p.scale ?? 1) || 1;
    return (mm3 / skala).toFixed(Number(p.rnd ?? 0));
  });

  // Templat convert bisa bersarang, jadi diulang sampai tidak ada lagi.
  for (let i = 0; i < 4; i += 1) {
    const sebelum = hasil;
    hasil = hasil.replace(
      /\{\{\s*(convert|cvt)\s*\|([^|{}]*)\|([^|{}\s]+)([^{}]*)\}\}/gi,
      (_m, _t, angka: string, unit: string, sisa: string) => {
        // "order=out" berarti satuannya diambil dari daftar satuan keluaran.
        const keluaran = /order\s*=\s*out/i.test(sisa)
          ? (sisa.match(/\|\s*([a-z]+)/i)?.[1] ?? unit)
          : unit;
        const nilai = Number(angka);
        if (Number.isFinite(nilai) && /^l$/i.test(unit) && /^cc/i.test(keluaran)) {
          return `${Math.round(nilai * 1000)} cc`;
        }
        // Daftar unit ("kW PS hp") hanya menyisakan satuan utama.
        return `${angka} ${unit}`;
      },
    );
    if (hasil === sebelum) break;
  }

  return (
    hasil
      // Tautan wiki diproses lebih dulu, selagi pipanya masih utuh:
      // [[Lamborghini V12#Second Generation|L539]] -> L539
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      // Templat daftar: {{unbulleted list|a|b}} -> a · b
      .replace(/\{\{\s*(unbulleted list|ubl|plainlist|flatlist|collapsible list)\s*\|?/gi, '')
      // Templat lain dibuang isinya.
      .replace(/\{\{[^{}]*\}\}/g, '')
      // Pipa sisa templat jadi pemisah yang enak dibaca.
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/&nbsp;/g, ' ')
      .replace(/'{2,}/g, '')
      .replace(/<br\s*\/?>/gi, ' · ')
      .replace(/\{\{|\}\}/g, ' ')
      .replace(/\b(abbr|order|disp|round|adj|sigfig|sp|us|first|out|frac|scale|rnd)\s*=\s*[\w-]*/gi, '')
      .replace(/\s*·\s*·\s*/g, ' · ')
      .replace(/(^|\s)·(\s|$)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s·,;/]+|[\s·,;/]+$/g, '')
      .replace(/^[a-z_]+\s*=\s*/i, '')
      .trim()
  );
}

interface CacheEntry {
  waktu: number;
  nilai: HasilPencarian;
}

const cache = new Map<string, CacheEntry>();

async function ambilJson(url: string, percobaan = 3): Promise<unknown | null> {
  for (let i = 0; i < percobaan; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA } });
      if (res.ok) return (await res.json()) as unknown;
      // 429/5xx layak dicoba ulang; 4xx lain tidak.
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // Jaringan putus atau timeout: coba lagi.
    } finally {
      clearTimeout(timer);
    }
    if (i < percobaan - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}

/** Kata kunci yang dibandingkan dengan judul halaman. */
function kataKunci(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((k) => k.length > 1 && !KATA_UMUM.has(k));
}

/**
 * Skor kecocokan judul dengan kata kunci, 0..1.
 *
 * Dipakai untuk membuang hasil yang meleset dan mengurutkan yang paling
 * relevan. Judul harus memuat kata kunci utama, bukan sekadar satu kata umum.
 */
export function skorJudul(judul: string, query: string): number {
  const kata = kataKunci(query);
  if (!kata.length) return 0;
  const j = judul.toLowerCase().trim();
  // Judul yang persis sama dengan kata kunci selalu menang, dan judul lain
  // tidak boleh menyamainya: "Bugatti 18/3 Chiron" adalah konsep 1999, bukan
  // Chiron 2016 yang dicari. Skor lain diskalakan ke bawah 0,85 supaya
  // urutannya tetap terjaga tanpa menyalip judul persis.
  if (j === query.toLowerCase().trim()) return 1;

  const cocok = kata.filter((k) => j.includes(k)).length;
  const dasar = cocok / kata.length;
  const awalan = j.startsWith(kata[0]) ? 0.15 : 0;
  // Setiap kata tambahan menandakan model lain, jadi diberi penalti.
  const kataJudul = j.split(/\s+/).filter(Boolean).length;
  const tambahan = Math.max(0, kataJudul - kata.length);
  const nilai = Math.max(0, dasar + awalan - 0.18 * tambahan);
  return Math.min(1, nilai) * 0.85;
}

/** Mengumpulkan kandidat judul dari dua API Wikipedia yang saling melengkapi. */
export async function cariJudulKandidat(query: string): Promise<string[]> {
  const judul: string[] = [];
  const tambah = (t: string) => {
    if (t && !judul.includes(t)) judul.push(t);
  };

  // 1. Pencarian isi artikel: tahan terhadap urutan kata yang berbeda.
  const p1 = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srlimit: '10',
    srsearch: query,
  });
  const d1 = (await ambilJson(`https://en.wikipedia.org/w/api.php?${p1}`)) as {
    query?: { search?: { title: string }[] };
  } | null;
  for (const s of d1?.query?.search ?? []) tambah(s.title);

  // 2. Pencocokan awalan judul: lebih tepat untuk nama model yang persis.
  const p2 = new URLSearchParams({ action: 'opensearch', format: 'json', limit: '10', search: query });
  const d2 = (await ambilJson(`https://en.wikipedia.org/w/api.php?${p2}`)) as unknown[] | null;
  if (Array.isArray(d2) && Array.isArray(d2[1])) {
    for (const t of d2[1] as string[]) tambah(t);
  }

  return judul;
}

interface HalamanWiki {
  title?: string;
  extract?: string;
  original?: { source?: string };
  revisions?: { slots?: { main?: { '*': string } } }[];
}

/**
 * Mengambil kandidat lengkap dalam SATU permintaan.
 *
 * `generator=search` digabung dengan `prop=extracts|pageimages|revisions`
 * membuat satu panggilan mengembalikan deskripsi, gambar, dan wikitext
 * sekaligus. Pola lama (satu permintaan per halaman) memicu pembatasan laju
 * Wikipedia setelah beberapa halaman, dan gejalanya menyesatkan: hasil yang
 * sebenarnya ada tampak "tidak lengkap" lalu dibuang.
 */
async function cariHalamanLengkap(query: string, limit: number): Promise<HalamanWiki[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(Math.min(20, limit * 3)),
    prop: 'extracts|pageimages|revisions',
    exintro: '1',
    explaintext: '1',
    piprop: 'original',
    rvprop: 'content',
    rvslots: 'main',
  });
  const data = (await ambilJson(`https://en.wikipedia.org/w/api.php?${params}`)) as {
    query?: { pages?: Record<string, HalamanWiki> };
  } | null;
  return data?.query?.pages ? Object.values(data.query.pages) : [];
}

/** Membaca satu wikitext mentah menjadi kolom spesifikasi. */
export function spekDariWikitext(teks: string): Partial<HasilMobil> {
  if (!teks) return {};
  const produksi = ambilInfobox(teks, 'production') || ambilInfobox(teks, 'model_years');
  const tahun = (produksi.match(/(1[89]\d{2}|20\d{2})/g) ?? []).slice(0, 2).join('–');

  return {
    tahun,
    generasi: rapikanNilai(ambilInfobox(teks, 'generation')),
    mesin: rapikanNilai(ambilInfobox(teks, 'engine')),
    transmisi: rapikanNilai(ambilInfobox(teks, 'transmission')),
    // Artikel mobil memakai 'powerout' atau 'power'; sebagian memakai 'output'.
    tenaga: rapikanNilai(
      ambilInfobox(teks, 'powerout') ||
        ambilInfobox(teks, 'power') ||
        ambilInfobox(teks, 'output'),
    ),
  };
}

/**
 * Menyaring halaman yang bukan satu model mobil.
 *
 * Tanpa ini, pencarian "Toyota Supra" memunculkan "Toyota Supra in motorsport"
 * dan halaman mesin, lalu spesifikasinya tercampur antar-model.
 */
export function layakJadiMobil(halaman: HalamanWiki, query: string): boolean {
  const judul = halaman.title ?? '';
  if (!judul) return false;
  const kecil = judul.toLowerCase();
  if (BUKAN_MODEL.some((k) => kecil.includes(k))) return false;
  if (!halaman.extract || halaman.extract.length < 40) return false;
  if (!halaman.original?.source) return false;
  // Halaman orang harus dibuang. Pencarian "Koenigsegg Jesko" juga memunculkan
  // "Christian von Koenigsegg" — seorang tokoh dengan foto dan biografi yang
  // menyebut "car manufacturer", sehingga lolos semua syarat lain.
  // Halaman perusahaan/produsen bukan model, walau judulnya memuat merek.
  if (/\b(automobiles?|motors?|company|manufacturer|ag|gmbh|inc\.?|ltd\.?|s\.?p\.?a\.?)\s*$/i.test(halaman.title.trim())) {
    return false;
  }
  const bio =
    /\b(born\s+\d|businessman|businesswoman|entrepreneur|he founded|she founded|is a [a-z]+ (engineer|designer|driver|executive))\b/i;
  if (bio.test(halaman.extract)) return false;
  // Dan deskripsinya harus menyebut kendaraan. Tanpa "\b" di ujung: JS tanpa
  // flag /u tidak menganggap huruf beraksen sebagai \w, sehingga "coupé"
  // gagal cocok dan mobil sungguhan ikut terbuang.
  if (!/\b(car|automobile|vehicle|supercar|hypercar|roadster|coup|sedan|hatchback|convertible)/i.test(halaman.extract)) {
    return false;
  }
  // Halaman merek ("Lamborghini") bukan satu model, jadi tidak dipakai sebagai
  // referensi visual satu mobil tertentu.
  if (judul.trim().split(/\s+/).length < 2 && !/\d/.test(judul)) return false;
  return skorJudul(judul, query) >= 0.5;
}

/** Angka generasi ke Romawi, karena judul wiki memakai angka Romawi. */
const ROMAWI: Record<string, string> = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII',
};

/**
 * Varian kata kunci untuk nama yang ditulis berbeda oleh Wikipedia.
 *
 * Contoh nyata: "Toyota Supra MK5" tidak ditemukan karena artikelnya berjudul
 * "Toyota GR Supra" (nama pasar AS) dan generasi keempat ditulis "MK IV".
 */
export function varianKueri(query: string): string[] {
  const q = query.trim();
  const varian: string[] = [];
  const romawi = q.replace(/\bmk\s?(\d)\b/gi, (m, d: string) => (ROMAWI[d] ? `MK ${ROMAWI[d]}` : m));
  if (romawi !== q) varian.push(romawi);
  // Buang penanda generasi: "Toyota Supra MK5" -> "Toyota Supra".
  const tanpaGenerasi = q.replace(/\bmk\s?\d+\b/gi, '').replace(/\s+/g, ' ').trim();
  if (tanpaGenerasi && tanpaGenerasi !== q) varian.push(tanpaGenerasi);
  // Varian berpemisah: "Porsche 911 GT3 RS" -> "Porsche 911 GT3".
  const tanpaAkhiran = q.replace(/\s+(rs|competition|type r)$/i, '').trim();
  if (tanpaAkhiran && tanpaAkhiran !== q) varian.push(tanpaAkhiran);
  return varian;
}

/**
 * Mencari mobil di internet.
 *
 * Hasil di-cache 10 menit: pengguna sering mengulang pencarian yang sama saat
 * membandingkan kandidat, dan Wikipedia membatasi laju permintaan.
 */
export async function cariMobilInternet(query: string, limit = 8): Promise<HasilPencarian> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 3) return { hasil: [], catatan: 'Kata kunci minimal 3 karakter' };

  // `limit` ikut jadi kunci cache. Tanpa ini, permintaan limit=2 yang tersimpan
  // membuat permintaan limit=8 berikutnya hanya mengembalikan 2 hasil.
  const kunci = `${q.toLowerCase()}|${limit}`;
  const tersimpan = cache.get(kunci);
  if (tersimpan && Date.now() - tersimpan.waktu < CACHE_TTL_MS) return tersimpan.nilai;

  // Kata kunci asli dicoba lebih dulu; varian hanya dipakai bila hasilnya
  // kosong atau tidak ada yang layak. Berhenti pada varian pertama yang
  // menghasilkan halaman mobil yang bisa dipakai.
  let layak: HalamanWiki[] = [];
  for (const percobaan of [q, ...varianKueri(q)]) {
    const halaman = await cariHalamanLengkap(percobaan, limit);
    const lolos = halaman.filter((h) => layakJadiMobil(h, q));
    if (lolos.length) {
      layak = lolos;
      break;
    }
  }

  if (!layak.length) {
    const nilai: HasilPencarian = {
      hasil: [],
      catatan: 'Tidak ada halaman mobil yang cocok di internet untuk kata kunci itu',
    };
    cache.set(kunci, { waktu: Date.now(), nilai });
    return nilai;
  }

  const urut = [...layak].sort(
    (a, b) => skorJudul(b.title ?? '', q) - skorJudul(a.title ?? '', q),
  );

  const hasil: HasilMobil[] = urut.slice(0, limit).map((h) => {
    const judul = h.title ?? '';
    const spek = spekDariWikitext(h.revisions?.[0]?.slots?.main?.['*'] ?? '');
    return {
      id: judul,
      nama: judul,
      merk: merkDari(judul),
      tahun: spek.tahun ?? '',
      generasi: spek.generasi ?? '',
      mesin: spek.mesin ?? '',
      transmisi: spek.transmisi ?? '',
      tenaga: spek.tenaga ?? '',
      deskripsi: (h.extract ?? '').replace(/\s+/g, ' ').slice(0, 400).trim(),
      gambarUrl: h.original?.source ?? '',
      halamanUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(judul.replace(/ /g, '_'))}`,
      sumber: 'internet' as const,
    };
  });

  const nilai: HasilPencarian = { hasil };
  cache.set(kunci, { waktu: Date.now(), nilai });
  return nilai;
}

/** Hanya untuk pengujian: mengosongkan cache. */
export function kosongkanCache(): void {
  cache.clear();
}
