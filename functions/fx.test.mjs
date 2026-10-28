import assert from "node:assert/strict";
import { fetchUsdRates, idrPerUnit, loadUsdRates, resetFxCache } from "./fx.mjs";

const RATES = { IDR: 16000, USD: 1, EUR: 0.9 };

// idrPerUnit: IDR itu sendiri tidak dikonversi; USD pakai kurs IDR; lintas mata uang lewat basis USD.
assert.equal(idrPerUnit(RATES, "IDR"), 1);
assert.equal(idrPerUnit(RATES, "usd"), 16000);
assert.equal(idrPerUnit(RATES, "EUR"), 16000 / 0.9);
// Tak dikenal / kurs rusak -> null, bukan 0: 0 akan mengklaim pendapatannya nol.
assert.equal(idrPerUnit(RATES, "GBP"), null);
assert.equal(idrPerUnit({ IDR: 16000, USD: 0 }, "USD"), null);
assert.equal(idrPerUnit(null, "USD"), null);

// fetchUsdRates: hanya menerima result "success" dengan IDR; selain itu melempar.
const okFetch = async () => ({
  ok: true,
  json: async () => ({ result: "success", rates: RATES, time_last_update_utc: "Wed, 13 Aug 2026" }),
});
const okRes = await fetchUsdRates(okFetch);
assert.equal(okRes.rates.IDR, 16000);
assert.equal(okRes.asOf, "Wed, 13 Aug 2026");

const badFetch = async () => ({
  ok: false,
  json: async () => ({ "error-type": "unsupported-code" }),
});
await assert.rejects(() => fetchUsdRates(badFetch), /FX open.er-api gagal/);

// loadUsdRates: sukses menulis cadangan; gagal jatuh ke cadangan tersimpan.
resetFxCache();
const writes = {};
const store = {
  read: async () => (writes[FX] ? { USD: writes[FX].USD, asOf: writes[FX].asOf } : null),
  update: async (_path, values) => Object.assign((writes[FX] ||= {}), values),
};
const FX = "fx";
const fresh = await loadUsdRates(store, { fetchImpl: okFetch });
assert.equal(fresh.stale, false);
assert.equal(fresh.rates.IDR, 16000);
assert.equal(writes[FX].USD.IDR, 16000); // cadangan ditulis

resetFxCache();
const stale = await loadUsdRates(store, { fetchImpl: badFetch });
assert.equal(stale.stale, true);
assert.equal(stale.rates.IDR, 16000); // dari cadangan

console.log("fx.test.mjs OK");
