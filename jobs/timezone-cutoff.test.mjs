import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adjustDateByGamTimezone,
  DOMAIN_GAM_TIMEZONES,
  getGamTimezoneForSubdomain,
  getWibCutoffHour,
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

  test("mengalokasikan spending sebelum cut-off ke hari kemarin (T-1) untuk GMT lebih lambat", () => {
    // GMT+5 (cut-off 02:00 WIB)
    assert.equal(adjustDateByGamTimezone("2026-11-08", 0, "GMT+5"), "2026-11-07");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 1, "GMT+5"), "2026-11-07");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 2, "GMT+5"), "2026-11-08");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 14, "GMT+5"), "2026-11-08");

    // GMT+6 (cut-off 01:00 WIB)
    assert.equal(adjustDateByGamTimezone("2026-11-08", 0, "GMT+6"), "2026-11-07");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 1, "GMT+6"), "2026-11-08");

    // GMT+1 (cut-off 06:00 WIB)
    assert.equal(adjustDateByGamTimezone("2026-11-08", 5, "GMT+1"), "2026-11-07");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 6, "GMT+1"), "2026-11-08");

    // GMT-3 (cut-off 10:00 WIB)
    assert.equal(adjustDateByGamTimezone("2026-11-08", 9, "GMT-3"), "2026-11-07");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 10, "GMT-3"), "2026-11-08");
  });

  test("mengalokasikan spending setelah cut-off ke hari esok (T+1) untuk GMT lebih cepat", () => {
    // GMT+8 (cut-off 23:00 WIB)
    assert.equal(adjustDateByGamTimezone("2026-11-08", 22, "GMT+8"), "2026-11-08");
    assert.equal(adjustDateByGamTimezone("2026-11-08", 23, "GMT+8"), "2026-11-09");
  });
});
