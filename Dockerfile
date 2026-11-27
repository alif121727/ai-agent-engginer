FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates tini \
      python3 python3-venv curl \
 && rm -rf /var/lib/apt/lists/*

# Piper: TTS lokal untuk narasi Bahasa Indonesia. Tanpa ini `ttsAvailable()`
# bernilai false, gate QA `narasi-ada` menolak setiap job yang naskahnya punya
# voiceover, sehingga render 9 tahap selalu berakhir `failed`.
# Dipasang di venv terpisah supaya tidak bertabrakan dengan paket sistem.
RUN python3 -m venv /opt/piper \
 && /opt/piper/bin/pip install --no-cache-dir piper-tts==1.8.0 \
 && ln -sf /opt/piper/bin/piper /usr/local/bin/piper

# Model TTS (61 MB) di-gitignore, jadi tidak ikut konteks build. Unduh di sini
# agar image bisa merender narasi tanpa langkah manual. Gagal unduh tidak
# menggagalkan build: server tetap hidup, hanya narasi yang tidak tersedia.

WORKDIR /app
COPY package.json package-lock.json* ./
# esbuild dan react ada di devDependencies, jadi tahap build butuh dev deps.
# Memisahkannya (install dev -> build -> prune) menjaga image akhir tetap kecil
# tanpa membuat build:studio gagal karena esbuild tidak terpasang.
RUN npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund

COPY . .

# Diunduh setelah COPY: `assets/tts/` hanya berisi MODEL_CARD di repo, dan
# salinan kode tidak boleh menimpa model yang sudah ada.
RUN mkdir -p /app/assets/tts \
 && for ext in onnx onnx.json; do \
      [ -f "/app/assets/tts/id_ID-news_tts-medium.$ext" ] && continue; \
      curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 420 \
        -o "/app/assets/tts/id_ID-news_tts-medium.$ext" \
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.$ext" \
      || echo "PERINGATAN: model TTS $ext gagal diunduh, narasi akan dilewati"; \
    done

# build:studio (bukan build:ui) karena server menyajikan public/ yang diisi
# build studio; build:ui menghasilkan UI lama dan tidak pernah dipakai di sini.
# MEDIA_OPTIONAL: galeri statis 159 MB sengaja tidak masuk konteks build, dan
# server menyajikan mp4 dari jobs/ lewat route API, bukan dari galeri itu.
RUN MEDIA_OPTIONAL=1 npm run build:studio \
 && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini sebagai init: ffmpeg meninggalkan proses anak, dan tanpa reaper container
# tidak berhenti bersih saat di-restart.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "src/api/main.ts"]
