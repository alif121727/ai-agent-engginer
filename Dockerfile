FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
# esbuild dan react ada di devDependencies, jadi tahap build butuh dev deps.
# Memisahkannya (install dev -> build -> prune) menjaga image akhir tetap kecil
# tanpa membuat build:studio gagal karena esbuild tidak terpasang.
RUN npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund

COPY . .
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
