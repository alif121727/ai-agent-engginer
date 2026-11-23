/**
 * Pencarian hybrid: katalog lokal dulu, internet bila tidak cukup.
 *
 * Katalog lokal diprioritaskan karena tiga hal yang tidak dimiliki hasil
 * internet: foto kendaraan sudah tersedia di `assets/own/`, suara mesin sudah
 * dikalibrasi per model, dan nama modelnya sudah dikenali pipeline. Hasil
 * internet dipakai untuk mobil yang belum ada di katalog, dan ditandai jelas
 * supaya pengguna tahu asal datanya.
 */
import { loadCatalog, searchModels, type CatalogModel } from '../core/catalog.ts';
import { cariMobilInternet, type HasilMobil } from './web.ts';

/** Satu bentuk untuk dua sumber, supaya UI tidak perlu bercabang. */
export interface KartuMobil {
  id: string;
  nama: string;
  merk: string;
  tahun: string;
  ringkas: string;
  gambarUrl: string;
  /** Dari mana data ini berasal. */
  sumber: 'lokal' | 'internet';
  /** Terisi untuk hasil lokal; dipakai memilih model di studio. */
  slug?: string;
  mesin?: string;
  tenaga?: string;
  transmisi?: string;
  generasi?: string;
  deskripsi?: string;
  halamanUrl?: string;
}

export interface HasilHybrid {
  kartu: KartuMobil[];
  /** Sumber yang benar-benar menjawab, untuk label di UI. */
  sumberDominan: 'lokal' | 'internet' | 'campuran';
  catatan?: string;
}

/** Foto lokal sebuah model, bila sudah tersedia di `assets/own/`. */
function gambarLokal(model: CatalogModel, adaFoto: (slug: string) => boolean): string {
  return adaFoto(model.slug) ? `/api/assets/${encodeURIComponent(model.slug)}/cover` : '';
}

/** Mengubah entri katalog menjadi kartu. */
export function kartuDariKatalog(model: CatalogModel, gambarUrl = ''): KartuMobil {
  return {
    id: `lokal:${model.slug}`,
    nama: model.model,
    merk: model.merk,
    tahun: model.tahun,
    ringkas: model.tagline || model.deskripsi,
    gambarUrl,
    sumber: 'lokal',
    slug: model.slug,
    mesin: model.mesin,
    tenaga: model.tenaga,
    deskripsi: model.deskripsi,
    halamanUrl: model.sumber,
  };
}

/** Mengubah hasil internet menjadi kartu. */
export function kartuDariInternet(hasil: HasilMobil): KartuMobil {
  return {
    id: `internet:${hasil.id}`,
    nama: hasil.nama,
    merk: hasil.merk,
    tahun: hasil.tahun,
    ringkas: hasil.deskripsi,
    gambarUrl: hasil.gambarUrl,
    sumber: 'internet',
    mesin: hasil.mesin,
    tenaga: hasil.tenaga,
    transmisi: hasil.transmisi,
    generasi: hasil.generasi,
    deskripsi: hasil.deskripsi,
    halamanUrl: hasil.halamanUrl,
  };
}

export interface OpsiHybrid {
  /** Paksa hanya mencari di katalog lokal. */
  lokalSaja?: boolean;
  /** Jumlah maksimum kartu. */
  limit?: number;
  /** Untuk pengujian: mengganti pemeriksa ketersediaan foto. */
  adaFoto?: (slug: string) => boolean;
}

/**
 * Mencari mobil dari dua sumber.
 *
 * Aturan alur:
 * 1. Katalog lokal dicari lebih dulu.
 * 2. Bila hasil lokal sudah cukup (>= `cukupLokal`), internet tidak dipanggil
 *    sama sekali — pencarian tetap cepat dan hemat.
 * 3. Bila hasil lokal kurang, internet melengkapi, dan hasilnya digabung.
 *
 * Kegagalan internet tidak pernah menggagalkan pencarian; hasil lokal tetap
 * dikembalikan dengan catatan.
 */
export async function cariMobilHybrid(
  query: string,
  opsi: OpsiHybrid = {},
): Promise<HasilHybrid> {
  const limit = opsi.limit ?? 8;
  const cukupLokal = 3;
  const adaFoto = opsi.adaFoto ?? (() => false);

  const cocokLokal = searchModels(query, limit);
  const lokal = cocokLokal.map((m) => kartuDariKatalog(m.model, gambarLokal(m.model, adaFoto)));

  if (opsi.lokalSaja) {
    return {
      kartu: lokal,
      sumberDominan: 'lokal',
      catatan: lokal.length ? undefined : 'Tidak ada di katalog lokal',
    };
  }

  // Satu hasil yang sangat cocok sudah cukup: "Porsche 911 GT3 RS" ada di
  // katalog, jadi memanggil internet hanya menambah 911 (993/996/997) yang
  // tidak diminta.
  const sangatCocok = (cocokLokal[0]?.score ?? 0) >= 0.95;
  if (lokal.length >= cukupLokal || (sangatCocok && lokal.length > 0)) {
    return { kartu: lokal, sumberDominan: 'lokal' };
  }

  const internet = await cariMobilInternet(query, limit);
  const kartuInternet = internet.hasil.map(kartuDariInternet);

  // Buang hasil internet yang sebenarnya mobil yang sama dengan hasil lokal,
  // supaya tidak muncul dua kartu untuk satu mobil.
  const namaLokal = new Set(lokal.map((k) => k.nama.toLowerCase().replace(/\s+/g, ' ')));
  const unik = kartuInternet.filter((k) => {
    const nama = k.nama.toLowerCase().replace(/\s+/g, ' ');
    if (namaLokal.has(nama)) return false;
    // "Toyota Supra" vs "Toyota Supra MK IV": anggap sama bila salah satu
    // memuat seluruh kata dari yang lain.
    for (const n of namaLokal) {
      const pendek = n.length < nama.length ? n : nama;
      const panjang = n.length < nama.length ? nama : n;
      if (pendek.split(' ').every((w) => panjang.includes(w))) return false;
    }
    return true;
  });

  const kartu = [...lokal, ...unik].slice(0, limit);
  const sumberDominan: HasilHybrid['sumberDominan'] =
    lokal.length && unik.length ? 'campuran' : lokal.length ? 'lokal' : 'internet';

  const catatan = !kartu.length
    ? internet.catatan ?? 'Tidak ada hasil dari katalog maupun internet'
    : undefined;

  return { kartu, sumberDominan, catatan };
}

/** Jumlah model di katalog lokal; dipakai UI untuk menampilkan cakupan. */
export function jumlahKatalog(): number {
  return loadCatalog().models.length;
}
