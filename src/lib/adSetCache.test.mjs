import assert from "node:assert/strict";
import test from "node:test";
import { adSetAgeNote, adSetCacheKey, createAdSetCache } from "./adSetCache.js";

// Jam palsu: menunggu dua menit sungguhan di dalam tes berarti tes yang jalan dua menit.
function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

function counter(value = "isi") {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return value;
    },
    get calls() {
      return calls;
    },
  };
}

test("buka baris lain lalu kembali: tidak menembak ulang", async () => {
  const clock = fakeClock();
  const cache = createAdSetCache({ clock: clock.now });
  const a = counter("campaign A");
  const b = counter("campaign B");
  const keyA = adSetCacheKey("u1", "120210");
  const keyB = adSetCacheKey("u1", "120211");

  assert.equal((await cache.read(keyA, a.load)).data, "campaign A");
  clock.advance(5_000);
  await cache.read(keyB, b.load);
  clock.advance(5_000);
  const again = await cache.read(keyA, a.load);

  assert.equal(a.calls, 1, "campaign yang sudah dibuka tidak diminta ulang");
  assert.equal(again.data, "campaign A");
  assert.equal(again.fromCache, true);
  // Umurnya ikut, karena panel harus bisa menyebutkannya.
  assert.equal(again.ageMs, 10_000);
});

test("lewat masa simpan: dibaca ulang", async () => {
  const clock = fakeClock();
  const cache = createAdSetCache({ ttlMs: 120_000, clock: clock.now });
  const load = counter();
  const key = adSetCacheKey("u1", "1");

  await cache.read(key, load.load);
  clock.advance(119_000);
  await cache.read(key, load.load);
  assert.equal(load.calls, 1, "masih di dalam masa simpan");

  clock.advance(2_000);
  await cache.read(key, load.load);
  assert.equal(load.calls, 2, "sudah lewat, dibaca ulang");
});

test("kunci memuat user DAN campaign", async () => {
  // Satu campaign bisa ditanyakan lewat baris profil yang berbeda, dan izinnya diperiksa per baris
  // itu — jawaban untuk yang satu tidak boleh dipakai untuk yang lain.
  const cache = createAdSetCache();
  const load = counter();
  await cache.read(adSetCacheKey("u1", "120210"), load.load);
  await cache.read(adSetCacheKey("u2", "120210"), load.load);
  assert.equal(load.calls, 2);
});

test("dua permintaan yang bersamaan jadi SATU panggilan", async () => {
  // Klik ganda, atau tutup-lalu-buka sebelum jawabannya datang. Tanpa ini keduanya menembak
  // sendiri-sendiri — bentuk request yang justru membuat sebuah app dicap anomali oleh Meta.
  const cache = createAdSetCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "isi";
  };
  const key = adSetCacheKey("u1", "1");
  const [first, second] = await Promise.all([cache.read(key, load), cache.read(key, load)]);
  assert.equal(calls, 1);
  assert.equal(first.data, "isi");
  assert.equal(second.data, "isi");
});

test("yang GAGAL tidak ikut tersimpan", async () => {
  const cache = createAdSetCache();
  const key = adSetCacheKey("u1", "1");
  await assert.rejects(() => cache.read(key, async () => Promise.reject(new Error("Meta 502"))));
  // Kegagalan yang ikut dicermin akan menjawab error yang sama selama dua menit walau Meta sudah
  // pulih sedetik kemudian.
  assert.equal(cache.peek(key), null);
  const ok = await cache.read(key, async () => "isi");
  assert.equal(ok.data, "isi");
});

test("Segarkan melewati cermin, dan hasilnya menggantikan isinya", async () => {
  const clock = fakeClock();
  const cache = createAdSetCache({ clock: clock.now });
  const key = adSetCacheKey("u1", "1");
  await cache.read(key, async () => "lama");
  clock.advance(1_000);
  const fresh = await cache.read(key, async () => "baru", { force: true });
  assert.equal(fresh.data, "baru");
  assert.equal(fresh.fromCache, false);
  assert.equal(cache.peek(key).data, "baru");
  assert.equal(cache.peek(key).ageMs, 0, "umurnya ikut ternol");
});

test("saklar yang disentuh membuang cerminnya", async () => {
  const cache = createAdSetCache();
  const key = adSetCacheKey("u1", "1");
  await cache.read(key, async () => "lama");
  cache.invalidate(key);
  assert.equal(cache.peek(key), null);
});

test("umur ditulis relatif, bukan jam dinding", () => {
  assert.equal(adSetAgeNote(0), "baru saja");
  assert.equal(adSetAgeNote(29_000), "baru saja");
  assert.equal(adSetAgeNote(60_000), "1 menit lalu");
  assert.equal(adSetAgeNote(150_000), "3 menit lalu");
  // Nilai yang tidak masuk akal tidak menghasilkan kalimat sama sekali — "NaN menit lalu" di bawah
  // angka uang lebih buruk daripada tidak ada keterangan.
  assert.equal(adSetAgeNote(undefined), "");
  assert.equal(adSetAgeNote(-5), "");
});
