import assert from "node:assert/strict";
import test from "node:test";
import { isSetupWarning, setupDetailLines } from "./setupSub.js";

test("kalimat bermasalah ditandai, yang berhasil tidak", () => {
  for (const line of [
    "Setting Sub: 3 dari 4 task berhasil.",
    "Halaman legal: 4 dibuat, 0 dilewati, 1 gagal.",
    "AutoPost: 19 dari 20 artikel dikirim.",
    "Menu belum lengkap: tanpa kategori.",
    "Setelan preset landing gagal: Tidak diterapkan situs: cloaking_url.",
    "Kode iklan dilewati: domain ini tidak punya akun GAM dan kode AdSense-nya tidak diisi.",
    "Keitaro: RABBIT T2 (WL) 1qLJ (prices.sheetz.us) (#169), gate problem.",
    "SSL gagal: DNS belum menjalar.",
  ]) {
    assert.equal(isSetupWarning(line), true, line);
  }
  for (const line of [
    "Setting Sub: 4 dari 4 task berhasil.",
    "Halaman legal: 5 dibuat, 0 dilewati, 0 gagal.",
    "Halaman legal: 3 dibuat, 2 dilewati, 0 gagal.",
    "Menu jadi.",
    "Keitaro: RABBIT T2 (WL) 1qLJ (prices.sheetz.us) (#169), gate ok.",
    "Plugin RabbitROI 0.4.75 ter-enroll.",
  ]) {
    assert.equal(isSetupWarning(line), false, line);
  }
});

test("keterangan dipecah per kalimat, titik di dalam hostname tidak memecah", () => {
  assert.deepEqual(setupDetailLines("Server 1.2.3.4. A record a.b.com dibuat. Menu jadi."), [
    "Server 1.2.3.4.",
    "A record a.b.com dibuat.",
    "Menu jadi.",
  ]);
  assert.deepEqual(setupDetailLines(""), []);
});
