/**
 * Validasi kualitas audio hasil render.
 *
 * Dipakai sebagai gerbang: `npm run validate:audio <video.mp4>`. Keluar dengan
 * kode 1 kalau ada satu saja yang gagal, supaya bisa dipasang di CI.
 *
 * Ambang batasnya bukan selera: -16 LUFS dan -1.5 dBTP adalah target yang
 * dipakai platform video besar, dan 48 kHz adalah laju standar untuk video.
 * Bitrate di bawah 192 kbps pada narasi terdengar "tertutup" di speaker ponsel.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MIN_LUFS = -17;
const MAX_LUFS = -15;
const MAX_TRUE_PEAK = -1.5;
const MIN_BITRATE_KBPS = 192;
const EXPECTED_SAMPLE_RATE = 48000;

export interface AudioReport {
  file: string;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  loudnessRange: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  durationSec: number | null;
  problems: string[];
}

function run(cmd: string, args: string[]): string {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

export function analyseAudio(file: string): AudioReport {
  const problems: string[] = [];
  if (!fs.existsSync(file)) {
    return {
      file,
      integratedLufs: null,
      truePeakDbtp: null,
      loudnessRange: null,
      sampleRate: null,
      channels: null,
      bitrateKbps: null,
      durationSec: null,
      problems: ['berkas tidak ada'],
    };
  }

  const loud = run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file,
    '-af', 'loudnorm=print_format=json',
    '-f', 'null', '-',
  ]);
  const json = loud.slice(loud.lastIndexOf('{'), loud.lastIndexOf('}') + 1);
  let integratedLufs: number | null = null;
  let truePeakDbtp: number | null = null;
  let loudnessRange: number | null = null;
  try {
    const parsed = JSON.parse(json) as Record<string, string>;
    integratedLufs = Number(parsed.input_i);
    truePeakDbtp = Number(parsed.input_tp);
    loudnessRange = Number(parsed.input_lra);
  } catch {
    problems.push('loudness tidak terbaca (audio kosong?)');
  }

  const probe = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels,bit_rate:format=duration,bit_rate',
    '-of', 'json', file,
  ]);
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitrateKbps: number | null = null;
  let durationSec: number | null = null;
  try {
    const parsed = JSON.parse(probe) as {
      streams?: { sample_rate?: string; channels?: number; bit_rate?: string }[];
      format?: { duration?: string; bit_rate?: string };
    };
    const stream = parsed.streams?.[0];
    sampleRate = stream?.sample_rate ? Number(stream.sample_rate) : null;
    channels = stream?.channels ?? null;
    const br = Number(stream?.bit_rate ?? parsed.format?.bit_rate ?? 0);
    bitrateKbps = br > 0 ? Math.round(br / 1000) : null;
    durationSec = parsed.format?.duration ? Number(parsed.format.duration) : null;
  } catch {
    problems.push('ffprobe gagal membaca trek audio');
  }

  if (integratedLufs !== null) {
    if (!Number.isFinite(integratedLufs)) problems.push('loudness bukan angka');
    else if (integratedLufs < MIN_LUFS || integratedLufs > MAX_LUFS) {
      problems.push(
        `loudness ${integratedLufs.toFixed(2)} LUFS di luar ${MIN_LUFS}..${MAX_LUFS}`,
      );
    }
  }
  if (truePeakDbtp !== null && Number.isFinite(truePeakDbtp) && truePeakDbtp > MAX_TRUE_PEAK) {
    problems.push(`true peak ${truePeakDbtp.toFixed(2)} dBTP melebihi ${MAX_TRUE_PEAK}`);
  }
  if (sampleRate !== null && sampleRate !== EXPECTED_SAMPLE_RATE) {
    problems.push(`sample rate ${sampleRate} Hz, seharusnya ${EXPECTED_SAMPLE_RATE}`);
  }
  if (bitrateKbps !== null && bitrateKbps < MIN_BITRATE_KBPS) {
    problems.push(`bitrate ${bitrateKbps} kbps di bawah ${MIN_BITRATE_KBPS}`);
  }
  if (channels !== null && channels < 2) problems.push(`hanya ${channels} kanal, seharusnya stereo`);

  return {
    file,
    integratedLufs,
    truePeakDbtp,
    loudnessRange,
    sampleRate,
    channels,
    bitrateKbps,
    durationSec,
    problems,
  };
}

/**
 * Bagian CLI hanya jalan saat berkas ini dieksekusi langsung. Tanpa penjagaan
 * ini, mengimpor `analyseAudio` di test suite akan ikut menjalankan CLI dan
 * mematikan proses.
 */
const isCli = process.argv[1]?.endsWith('validate-audio.ts') ?? false;

if (isCli) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('pakai: npm run validate:audio <berkas.mp4|m4a> [...]');
    process.exit(2);
  }

  let failed = 0;
  for (const file of files) {
    const r = analyseAudio(file);
    const status = r.problems.length === 0 ? 'LULUS' : 'GAGAL';
    console.log(`\n${status}  ${file}`);
    console.log(
      `  loudness ${r.integratedLufs?.toFixed(2) ?? '?'} LUFS · ` +
        `true peak ${r.truePeakDbtp?.toFixed(2) ?? '?'} dBTP · ` +
        `LRA ${r.loudnessRange?.toFixed(1) ?? '?'}`,
    );
    console.log(
      `  ${r.sampleRate ?? '?'} Hz · ${r.channels ?? '?'} kanal · ` +
        `${r.bitrateKbps ?? '?'} kbps · ${r.durationSec?.toFixed(1) ?? '?'} dtk`,
    );
    for (const p of r.problems) console.log(`  - ${p}`);
    if (r.problems.length) failed += 1;
  }

  process.exit(failed === 0 ? 0 : 1);
}
