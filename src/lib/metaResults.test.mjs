import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resultLabel } from "./metaResults.js";

describe("resultLabel", () => {
  test("nama baca untuk event yang dihitung sebagai hasil", () => {
    assert.equal(resultLabel("offsite_conversion.fb_pixel_view_content"), "Konten dilihat");
    assert.equal(resultLabel("link_click"), "Klik tautan");
    assert.equal(resultLabel("onsite_conversion.lead_grouped"), "Prospek (formulir)");
  });

  test("event yang belum dikenal tampil apa adanya, bukan disembunyikan", () => {
    // Nama teknisnya masih bisa dicari di dokumentasi Meta; "-" akan menyembunyikan bahwa kolomnya
    // menghitung sesuatu yang belum pernah kami lihat.
    assert.equal(resultLabel("offsite_conversion.fb_pixel_custom"), "offsite_conversion.fb_pixel_custom");
  });

  test("tanpa event, tanpa label", () => {
    assert.equal(resultLabel(""), "");
    assert.equal(resultLabel(undefined), "");
  });
});
