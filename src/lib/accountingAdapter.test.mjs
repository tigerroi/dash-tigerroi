import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBonusPercentPayload,
  normalizeBonusPercentRow,
  formatAdxCostPayload,
  normalizeAdxCostRow,
  formatInvalidTrafficPayload,
  normalizeInvalidTrafficRow,
} from "./accountingAdapter.js";

test("formatBonusPercentPayload sets both user and user_name", () => {
  const payload = formatBonusPercentPayload({
    user: "Mas Def",
    percent: 15,
    effectiveFrom: "2026-05-01",
  });

  assert.equal(payload.user, "Mas Def");
  assert.equal(payload.user_name, "Mas Def");
  assert.equal(payload.percent, 15);
  assert.equal(payload.month, "2026-05");
});

test("normalizeBonusPercentRow maps user_name to user", () => {
  const row = {
    id: "bp-1",
    user_name: "Aca",
    percent: 10,
  };

  const normalized = normalizeBonusPercentRow(row);
  assert.equal(normalized.user, "Aca");
  assert.equal(normalized.userName, "Aca");
});

test("formatAdxCostPayload properly handles nominal and costUsd", () => {
  const payload = formatAdxCostPayload({
    domain: "https://trayedit.com",
    date: "2026-06-01",
    companyName: "AdsVenture",
    costUsd: 70,
    nominal: 1250000,
    approvalStatus: "Approve",
    setupAdx: "Done",
  });

  assert.equal(payload.domain, "https://trayedit.com");
  assert.equal(payload.cost_usd, 70);
  assert.equal(payload.cost, 70);
  assert.equal(payload.nominal, 1250000);
  assert.equal(payload.amount, 1250000);
  assert.equal(payload.approval_status, "Approve");
  assert.equal(payload.setup_adx, "Done");
});

test("normalizeAdxCostRow falls back to amount if nominal is missing", () => {
  const row = {
    id: "adx-1",
    domain: "https://trayedit.com",
    amount: 1000000,
    cost: 65,
  };

  const normalized = normalizeAdxCostRow(row);
  assert.equal(normalized.nominal, 1000000);
  assert.equal(normalized.costUsd, 65);
});

test("formatInvalidTrafficPayload computes total nominal from check1, check2, check3", () => {
  const payload = formatInvalidTrafficPayload({
    domain: "https://ihopmenuwithprices.us",
    month: "2026-04",
    check1: 50000,
    check2: 30000,
    check3: 20000,
  });

  assert.equal(payload.domain, "https://ihopmenuwithprices.us");
  assert.equal(payload.date, "2026-04-01");
  assert.equal(payload.check1, 50000);
  assert.equal(payload.check2, 30000);
  assert.equal(payload.check3, 20000);
  assert.equal(payload.nominal, 100000);
  assert.equal(payload.amount, 100000);
});

