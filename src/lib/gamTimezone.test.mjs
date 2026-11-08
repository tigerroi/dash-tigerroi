import assert from "node:assert/strict";
import test from "node:test";
import { formatGamZoneWithTime, getGamTimeParts, GAM_DEFAULT_TIMEZONES } from "./gamTimezone.js";

test("getGamTimeParts memproses GMT+5 dengan benar", () => {
  // Patokan waktu tetap: 2026-11-08T05:00:00Z (jam 12:00 WIB, jam 10:00 di GMT+5)
  const d = new Date("2026-11-08T05:00:00Z");
  const parts = getGamTimeParts("GMT+5", d);
  assert.ok(parts);
  assert.equal(parts.time, "10:00");
  assert.equal(parts.tzLabel, "GMT+5");
});

test("formatGamZoneWithTime memproses offset dengan spasi seperti 'GMT +5' dan 'GMT-3'", () => {
  const d = new Date("2026-11-08T05:00:00Z"); // jam 10:00 di GMT+5, jam 02:00 di GMT-3
  const strPlus5 = formatGamZoneWithTime("GMT +5", d);
  assert.equal(strPlus5, "GMT+5 · Jam 10:00");

  const strMinus3 = formatGamZoneWithTime("GMT-3", d);
  assert.equal(strMinus3, "GMT-3 · Jam 02:00");
});

test("GAM_DEFAULT_TIMEZONES memuat 6 domain resmi", () => {
  assert.equal(GAM_DEFAULT_TIMEZONES["cmhhealths.com"], "GMT+1");
  assert.equal(GAM_DEFAULT_TIMEZONES["trayedit.com"], "GMT+6");
  assert.equal(GAM_DEFAULT_TIMEZONES["tiktokmodapk.net"], "GMT+5");
  assert.equal(GAM_DEFAULT_TIMEZONES["tacobellmenuu.us"], "GMT+5");
  assert.equal(GAM_DEFAULT_TIMEZONES["ihopmenuwithprices.us"], "GMT-3");
  assert.equal(GAM_DEFAULT_TIMEZONES["uniqueinfo24.com"], "GMT+6");
});
