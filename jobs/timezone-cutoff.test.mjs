import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DOMAIN_GAM_TIMEZONES,
  getGamTimezoneForSubdomain,
  getWibCutoffHour,
  resolveGamTargetDate,
} from "./timezone-cutoff.js";

describe("timezone-cutoff", () => {
  test("menghitung jam cut-off WIB dengan tepat per offset GMT", () => {
    assert.equal(getWibCutoffHour("GMT+5"), 2); // 02:00 WIB
    assert.equal(getWibCutoffHour("GMT+6"), 1); // 01:00 WIB
    assert.equal(getWibCutoffHour("GMT+1"), 6); // 06:00 WIB
    assert.equal(getWibCutoffHour("GMT-3"), 10); // 10:00 WIB
    assert.equal(getWibCutoffHour("GMT+7"), 0); // 00:00 WIB (sama)
    assert.equal(getWibCutoffHour("GMT+8"), 23); // 23:00 WIB
  });

  test("mencocokkan zona waktu GAM dari daftar domain resmi", () => {
    assert.equal(getGamTimezoneForSubdomain("menu.tacobellmenuu.us"), "GMT+5");
    assert.equal(getGamTimezoneForSubdomain("careers.tiktokmodapk.net"), "GMT+5");
    assert.equal(getGamTimezoneForSubdomain("decor.trayedit.com"), "GMT+6");
    assert.equal(getGamTimezoneForSubdomain("insurance.uniqueinfo24.com"), "GMT+6");
    assert.equal(getGamTimezoneForSubdomain("fitness.cmhhealths.com"), "GMT+1");
    assert.equal(getGamTimezoneForSubdomain("deals.ihopmenuwithprices.us"), "GMT-3");
  });

  test("resolveGamTargetDate: alokasikan ke T-1 jika jam sekarang belum capai cutoff", () => {
    // GMT+5 (cut-off 02:00 WIB)
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 0, "GMT+5"), "2026-11-07");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 1, "GMT+5"), "2026-11-07");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 2, "GMT+5"), "2026-11-08");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 7, "GMT+5"), "2026-11-08");

    // GMT+6 (cut-off 01:00 WIB)
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 0, "GMT+6"), "2026-11-07");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 1, "GMT+6"), "2026-11-08");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 7, "GMT+6"), "2026-11-08");

    // GMT+1 (cut-off 06:00 WIB)
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 5, "GMT+1"), "2026-11-07");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 6, "GMT+1"), "2026-11-08");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 7, "GMT+1"), "2026-11-08");

    // GMT-3 (cut-off 10:00 WIB)
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 7, "GMT-3"), "2026-11-07");
    assert.equal(resolveGamTargetDate("2026-11-08", "2026-11-08", 10, "GMT-3"), "2026-11-08");

    // Tanggal lampau tidak diubah
    assert.equal(resolveGamTargetDate("2026-11-07", "2026-11-08", 0, "GMT+5"), "2026-11-07");
  });
});
