/**
 * Teks spesifikasi beranimasi di atas klip scene.
 *
 * Caption lama hanya satu baris statis di bawah frame. Di sini ada enam gaya
 * yang dipilih otomatis dari isi teks, dengan animasi masuk dan keluar supaya
 * mata penonton sempat membacanya tanpa terasa seperti subtitle.
 *
 * Animasi dibuat lewat ekspresi `drawtext` (`%{eif:...}`) dan `enable`, bukan
 * dengan merender puluhan PNG per frame: satu perintah ffmpeg per klip, tanpa
 * berkas sementara.
 */

export type OverlayStyle =
  | 'stat_callout'
  | 'count_up'
  | 'lower_third'
  | 'full_screen_stat'
  | 'kinetic'
  | 'spec_bar';

export interface OverlaySpec {
  style: OverlayStyle;
  headline: string;
  /** Angka yang dianimasikan; hanya untuk count_up dan spec_bar. */
  value?: number;
  unit?: string;
  subtext?: string;
  /** Bar untuk spec_bar: label + nilai relatif 0-1. */
  bars?: { label: string; ratio: number }[];
}

/** Angka dengan pemisah ribuan gaya Indonesia: 1450 -> "1.450". */
function formatNumber(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Memilih gaya overlay dari teks yang tersedia.
 *
 * Urutannya sengaja: angka lebih dulu karena angka adalah daya tarik utama
 * video otomotif, baru kemudian teks panjang dan pendek.
 */
export function chooseOverlayStyle(text: string, subtext = ''): OverlayStyle {
  const gabung = `${text} ${subtext}`.trim();
  if (!gabung) return 'lower_third';

  // Angka di dalam nama model bukan spesifikasi: "Porsche 911 GT3 RS" tidak
  // boleh dianimasikan sebagai angka yang dihitung naik.
  if (isModelName(gabung)) {
    return gabung.length >= 46 ? 'full_screen_stat' : 'stat_callout';
  }

  if (/\d/.test(gabung)) {
    // Beberapa angka yang benar-benar berpasangan dengan satuan -> bar.
    const bars = extractBars(gabung);
    if (bars.length >= 2) return 'spec_bar';
    // Satu angka dominan -> hitung naik.
    const angka = gabung.match(/\d+(?:[.,]\d+)?/g) ?? [];
    return angka.length >= 1 ? 'count_up' : 'lower_third';
  }
  if (gabung.length <= 18) return 'stat_callout';
  if (gabung.length >= 46) return 'full_screen_stat';
  return 'lower_third';
}

/**
 * Nama model dikenali dari pola khas: merek diikuti kode/tipe.
 *
 * Daftar merek dibuat pendek dan eksplisit; menebak lewat heuristik angka saja
 * pernah membuat "Porsche 911 GT3 RS" jadi bar spesifikasi.
 */
const MEREK = [
  'porsche', 'ferrari', 'lamborghini', 'mclaren', 'bmw', 'mercedes', 'amg',
  'audi', 'nissan', 'toyota', 'honda', 'ford', 'chevrolet', 'corvette',
  'subaru', 'mazda', 'jaguar', 'datsun', 'lancia', 'tesla', 'lucid', 'bentley',
  'rolls', 'maybach', 'supra', 'skyline', 'mustang', 'taycan', 'huracan',
];

function isModelName(text: string): boolean {
  const kecil = text.toLowerCase();
  const adaMerek = MEREK.some((m) => kecil.includes(m));
  if (!adaMerek) return false;
  // "Porsche 911 GT3 RS" / "Ferrari 296 GTB" / "BMW M4 G82": merek + kode.
  return /\b[a-z]+[\s-]*\d|\bm\d|\bgt\s?\d|\brs\b|\bgts\b/i.test(text);
}

/**
 * Memecah teks bebas menjadi bagian-bagian overlay.
 *
 * "525 PS" menjadi headline kosong dengan value 525 dan unit "PS", sedangkan
 * "aerodinamika aktif" tetap jadi headline. Tanpa pemecahan ini animasi angka
 * tidak punya nilai untuk dihitung.
 */
export function parseOverlay(text: string, subtext = ''): OverlaySpec {
  const bersih = text.trim();
  const style = chooseOverlayStyle(bersih, subtext);
  const cocok = bersih.match(/^([^\d]*?)(\d[\d.,]*)\s*([^\d]*)$/);

  if (cocok && (style === 'count_up' || style === 'spec_bar')) {
    const angka = Number(cocok[2].replace(/\./g, '').replace(',', '.'));
    const satuan = cocok[3].trim();
    if (Number.isFinite(angka)) {
      if (style === 'spec_bar') {
        const bars = extractBars(bersih);
        // Tanpa minimal dua pasangan label+nilai, bar tidak punya arti.
        if (bars.length >= 2) {
          return { style, headline: bersih, value: angka, unit: satuan, subtext, bars };
        }
        return { style: 'count_up', headline: cocok[1].trim(), value: angka, unit: satuan, subtext };
      }
      return {
        style,
        headline: cocok[1].trim(),
        value: angka,
        unit: satuan,
        subtext,
      };
    }
  }

  return { style, headline: bersih, subtext };
}

/**
 * Mengambil pasangan label+angka untuk gaya bar, dinormalkan ke 0-1.
 *
 * Label boleh berada sebelum angka ("Tenaga 525 PS") atau tidak sama sekali
 * ("525 PS"); pada bentuk kedua satuan dipakai sebagai label.
 */
function extractBars(text: string): { label: string; ratio: number }[] {
  const potongan = text.split(/[·•|,]/).map((s) => s.trim()).filter(Boolean);
  const pasangan = potongan
    .map((s) => {
      // Angka bisa di mana saja; sisa teks sebelum & sesudahnya jadi label.
      const m = s.match(/^(.*?)(\d[\d.,]*)\s*(.*)$/);
      if (!m) return null;
      const nilai = Number(m[2].replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(nilai)) return null;
      const label = `${m[1].trim()} ${m[3].trim()}`.trim();
      return { label: label || 'Nilai', nilai };
    })
    .filter((x): x is { label: string; nilai: number } => x !== null);

  if (pasangan.length < 2) return [];
  const maks = Math.max(...pasangan.map((p) => p.nilai));
  return pasangan.map((p) => ({ label: p.label, ratio: Math.max(0.08, p.nilai / maks) }));
}

/** Escape teks agar aman di dalam nilai filter ffmpeg. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\u2019")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

export interface OverlayContext {
  /** Durasi klip tempat overlay ditempel, untuk menghitung timing. */
  durationSec: number;
  width: number;
  height: number;
  fontFile: string;
  fps: number;
}

/** Jendela tampil: masuk, diam, keluar. Dijaga tidak menabrak tepi klip. */
function window(durationSec: number): { in: number; out: number; masuk: number; keluar: number } {
  const masuk = Math.min(0.35, durationSec * 0.12);
  const keluar = Math.min(0.35, durationSec * 0.12);
  const mulai = Math.min(0.4, durationSec * 0.1);
  const selesai = Math.max(mulai + 1.2, durationSec - keluar);
  return { in: mulai, out: selesai, masuk, keluar };
}

/**
 * Membangun rantai filter `drawtext` untuk satu overlay.
 *
 * Mengembalikan string kosong bila tidak ada yang bisa digambar, supaya
 * pemanggil tidak perlu tahu detail gaya.
 */
export function buildOverlayFilters(spec: OverlaySpec, ctx: OverlayContext): string[] {
  const { durationSec, width, height, fontFile, fps } = ctx;
  if (durationSec <= 0.2) return [];
  const w = window(durationSec);
  const font = fontFile.replace(/([:\\'])/g, '\\$1');
  const out: string[] = [];

  // Ekspresi alpha dipakai semua gaya supaya masuk/keluar terasa halus.
  const alpha =
    `if(lt(t,${w.in}),0,` +
    `if(lt(t,${w.in + w.masuk}),(t-${w.in})/${w.masuk},` +
    `if(lt(t,${w.out}),1,` +
    `if(lt(t,${w.out + w.keluar}),(${w.out + w.keluar}-t)/${w.keluar},0))))`;

  const dasar = (text: string, size: number, y: string, warna = 'white') =>
    `drawtext=fontfile=${font}:text='${escapeDrawtext(text)}':fontcolor=${warna}` +
    `:fontsize=${size}:borderw=${Math.max(2, Math.round(size / 18))}:bordercolor=black@0.85` +
    `:x=(w-text_w)/2:y=${y}:alpha='${alpha}'`;

  const skala = Math.round(width / 15);
  const skalaKecil = Math.round(width / 34);

  switch (spec.style) {
    case 'count_up': {
      // Angka terakhir harus tepat menyentuh target: frame terakhir ada di
      // durasi - 1/fps, bukan di durasi.
      const akhir = Math.max(0.1, durationSec - 1 / fps);
      const target = spec.value ?? 0;
      const satuan = spec.unit ? ` ${spec.unit}` : '';
      const teks =
        `%{eif\\:trunc(${target}*min(1\\,t/${akhir.toFixed(4)}))\\:d}${escapeDrawtext(satuan)}`;
      out.push(
        `drawtext=fontfile=${font}:text='${teks}':fontcolor=white` +
          `:fontsize=${skala}:borderw=${Math.max(3, Math.round(skala / 16))}:bordercolor=black@0.9` +
          `:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(height * 0.06)}:alpha='${alpha}'`,
      );
      if (spec.headline) {
        out.push(dasar(spec.headline, skalaKecil, `(h-text_h)/2+${Math.round(height * 0.13)}`, '0xE5E7EB'));
      }
      break;
    }

    case 'stat_callout':
      out.push(dasar(spec.headline, skala, `(h-text_h)/2-${Math.round(height * 0.05)}`));
      if (spec.subtext) {
        out.push(dasar(spec.subtext, skalaKecil, `(h-text_h)/2+${Math.round(height * 0.12)}`, '0xD1D5DB'));
      }
      break;

    case 'full_screen_stat': {
      // Pita gelap supaya teks panjang tetap terbaca di atas foto terang.
      out.push(
        `drawbox=x=0:y=${Math.round(height * 0.3)}:w=${width}:h=${Math.round(height * 0.4)}` +
          `:color=black@0.72:t=fill:enable='between(t,${w.in},${w.out + w.keluar})'`,
      );
      const ukuran = Math.round(width / 26);
      out.push(dasar(spec.headline, ukuran, `(h-text_h)/2-${Math.round(height * 0.04)}`));
      if (spec.subtext) {
        out.push(dasar(spec.subtext, skalaKecil, `(h-text_h)/2+${Math.round(height * 0.1)}`, '0xD1D5DB'));
      }
      break;
    }

    case 'lower_third': {
      const y = Math.round(height * 0.74);
      out.push(
        `drawbox=x=${Math.round(width * 0.06)}:y=${y}:w=${Math.round(width * 0.44)}:h=${Math.round(height * 0.16)}` +
          `:color=black@0.66:t=fill:enable='between(t,${w.in},${w.out + w.keluar})'`,
      );
      out.push(
        `drawtext=fontfile=${font}:text='${escapeDrawtext(spec.headline)}':fontcolor=white` +
          `:fontsize=${skalaKecil}:borderw=2:bordercolor=black@0.8` +
          `:x=${Math.round(width * 0.09)}:y=${y + Math.round(height * 0.025)}:alpha='${alpha}'`,
      );
      if (spec.subtext) {
        out.push(
          `drawtext=fontfile=${font}:text='${escapeDrawtext(spec.subtext)}':fontcolor=0xD1D5DB` +
            `:fontsize=${Math.round(skalaKecil * 0.72)}:borderw=1:bordercolor=black@0.7` +
            `:x=${Math.round(width * 0.09)}:y=${y + Math.round(height * 0.095)}:alpha='${alpha}'`,
        );
      }
      break;
    }

    case 'kinetic': {
      // Teks melintas: x bergerak dari kanan luar ke kiri luar.
      const jarak = `(w+text_w)*(1-(t-${w.in})/${Math.max(0.4, w.out - w.in)})`;
      out.push(
        `drawtext=fontfile=${font}:text='${escapeDrawtext(spec.headline)}':fontcolor=white` +
          `:fontsize=${skalaKecil}:borderw=3:bordercolor=black@0.85` +
          `:x='${jarak}':y=(h-text_h)/2:alpha='${alpha}'`,
      );
      break;
    }

    case 'spec_bar': {
      const bars = spec.bars?.length ? spec.bars : [{ label: spec.headline, ratio: 1 }];
      const lebarMaks = Math.round(width * 0.5);
      const tinggiBar = Math.max(8, Math.round(height * 0.018));
      const mulaiY = Math.round(height * 0.36);
      bars.slice(0, 4).forEach((bar, i) => {
        const y = mulaiY + i * Math.round(height * 0.1);
        // Lebar tumbuh dari 0 ke target selama 0,8 detik.
        const tumbuh = `min(1,max(0,(t-${w.in})/0.8))`;
        out.push(
          `drawbox=x=${Math.round(width * 0.25)}:y=${y}:w='${lebarMaks}*${bar.ratio.toFixed(3)}*${tumbuh}'` +
            `:h=${tinggiBar}:color=0xDC2626@0.9:t=fill:enable='between(t,${w.in},${w.out + w.keluar})'`,
        );
        out.push(
          `drawtext=fontfile=${font}:text='${escapeDrawtext(bar.label)}':fontcolor=white` +
            `:fontsize=${Math.round(skalaKecil * 0.8)}:borderw=2:bordercolor=black@0.8` +
            `:x=${Math.round(width * 0.25)}:y=${y - Math.round(height * 0.045)}:alpha='${alpha}'`,
        );
      });
      break;
    }
  }

  return out;
}

/** Ringkasan satu baris untuk log job. */
export function describeOverlay(spec: OverlaySpec): string {
  const bagian = [spec.style];
  if (spec.headline) bagian.push(`"${spec.headline}"`);
  if (spec.value !== undefined) bagian.push(`${formatNumber(spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`);
  return bagian.join(' ');
}

export { formatNumber };
