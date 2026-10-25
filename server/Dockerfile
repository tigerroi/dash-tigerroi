FROM oven/bun:1 AS deps
WORKDIR /app

# server/ mengimpor modul di functions/ (gating-core, keitaro-gate, sync-gating, db, store, roles).
# Logikanya sengaja TIDAK diduplikasi, jadi image ini harus memuat keduanya — dan `functions` butuh
# node_modules-nya sendiri untuk `firebase`.
COPY server/package.json server/bun.lock* ./server/
COPY functions/package.json functions/package-lock.json ./functions/
RUN cd server && bun install --frozen-lockfile || bun install
RUN cd functions && bun install --production

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production

# Jejak aktivitas tinggal di SQLite (server/activity-db.js), bukan lagi RTDB. File-nya HARUS di
# volume yang bertahan lewat redeploy — tanpa mount, `/data` cuma volume anonim dan jejaknya hilang
# tiap container diganti. Di produksi, mount volume bernama / host-path ke /data.
ENV ACTIVITY_DB_PATH=/data/activity.sqlite
VOLUME /data
RUN mkdir -p /data

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/functions/node_modules ./functions/node_modules
COPY functions ./functions
COPY server ./server

# Tanpa auth, tanpa RTDB, tanpa Keitaro — supaya health check tetap menjawab justru saat semua itu
# sedang bermasalah.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 8080
WORKDIR /app/server
CMD ["bun", "index.js"]
