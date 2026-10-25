import assert from "node:assert/strict";
import test from "node:test";
import { getCampaignTone } from "./campaignTone.js";

// Nada warna dibaca dari LABELNYA, dan label ad set diawali kata "Aktif" — jadi urutan
// pemeriksaannya yang menentukan. Salahnya tidak berbunyi di mana pun: yang terlihat cuma pil hijau
// untuk ad set yang justru sedang tidak menayangkan apa-apa.
test("kosakata campaign tidak ikut berubah warna", () => {
  assert.equal(getCampaignTone("Aktif"), "active");
  assert.equal(getCampaignTone("Terjadwal"), "scheduled");
  assert.equal(getCampaignTone("Tidak aktif"), "inactive");
  assert.equal(getCampaignTone("Nonaktif"), "inactive");
  assert.equal(getCampaignTone("Tidak ada di Meta"), "inactive");
  assert.equal(getCampaignTone(""), "inactive");
});

test("hanya ad set yang tidak menayangkan apa pun yang merah", () => {
  assert.equal(getCampaignTone("Tidak ditayangkan"), "danger");
  // Dan ia tidak boleh tertelan pemeriksaan "tidak aktif" di atasnya, yang mengawali kata yang sama.
  assert.notEqual(getCampaignTone("Tidak ditayangkan"), "inactive");
});
