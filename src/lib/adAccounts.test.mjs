import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeActId,
  normalizeAdAccountRow,
  formatAdAccountPayload,
} from "./adAccountAdapter.js";

test("normalizeActId adds act_ prefix when missing", () => {
  assert.equal(normalizeActId("123456789"), "act_123456789");
  assert.equal(normalizeActId("act_123456789"), "act_123456789");
  assert.equal(normalizeActId("  998877  "), "act_998877");
  assert.equal(normalizeActId(""), "");
  assert.equal(normalizeActId(null), "");
});

test("normalizeAdAccountRow maps account_id to actId and accountId", () => {
  const row = {
    id: "acc-1",
    account_id: "123456789",
    name: "Akun Testing",
    user_owner: "Mas Def",
    balance: 500000,
  };

  const normalized = normalizeAdAccountRow(row);
  assert.equal(normalized.accountId, "act_123456789");
  assert.equal(normalized.actId, "act_123456789");
  assert.equal(normalized.syncDisabled, false);
  assert.equal(normalized.syncStatus, "Aktif");
});

test("normalizeAdAccountRow detects INACTIVE status as syncDisabled", () => {
  const row = {
    id: "acc-2",
    account_id: "act_555",
    status: "INACTIVE",
  };

  const normalized = normalizeAdAccountRow(row);
  assert.equal(normalized.syncDisabled, true);
  assert.equal(normalized.syncStatus, "Nonaktif");
});

test("normalizeAdAccountRow calculates balance from account spending limit (spend_cap - amount_spent)", () => {
  const row = {
    id: "acc-3",
    account_id: "act_78605197914174",
    name: "Akun Meta",
    spend_cap: 31000000,
    amount_spent: 31000000,
    balance: 146741, // invoice due di Meta
  };

  const normalized = normalizeAdAccountRow(row);
  // Sisa saldo limit harus 0, bukan 146741 (tagihan berjalan)
  assert.equal(normalized.balance, 0);
  assert.equal(normalized.amountDue, 146741);
  assert.equal(normalized.spendCap, 31000000);
  assert.equal(normalized.amountSpent, 31000000);

  // Jika limit masih tersisa
  const remainingRow = {
    ...row,
    amount_spent: 25000000,
  };
  const normalizedRemaining = normalizeAdAccountRow(remainingRow);
  assert.equal(normalizedRemaining.balance, 6000000);
});

test("formatAdAccountPayload builds valid DB payload", () => {
  const values = {
    name: "Akun Baru",
    actId: "123456789",
    userOwner: "Mas Def",
    syncDisabled: false,
  };

  const payload = formatAdAccountPayload(values);
  assert.equal(payload.name, "Akun Baru");
  assert.equal(payload.account_id, "act_123456789");
  assert.equal(payload.act_id, "act_123456789");
  assert.equal(payload.user_owner, "Mas Def");
  assert.equal(payload.status, "ACTIVE");
  assert.equal(payload.sync_disabled, false);
});
