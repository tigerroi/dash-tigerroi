import assert from "node:assert/strict";
import test from "node:test";
import { describeMappingSource, fleetCampaignRows, normalizeCampaignRows } from "./campaignRows.js";

test("baris lama tanpa campaignId tetap lahir, dengan alamat Meta kosong", () => {
  const [row] = normalizeCampaignRows([{ campaign: "A" }]);
  assert.equal(row.id, "A");
  assert.equal(row.campaignId, "");
  assert.equal(row.account, "-");
  assert.equal(row.dailyBudget, "-");
});

test("armada: seluruh pemilik, id unik per pemilik, perintah saklar ikut barisnya", () => {
  const rows = fleetCampaignRows([
    {
      id: "u1",
      name: "Nurjaman",
      campaigns: [{ campaignId: "1", campaign: "TvH1-06" }],
      campaignCommands: { 1: { state: "pending", desiredStatus: "PAUSED" } },
    },
    { id: "u2", email: "aldi@r.live", campaigns: [{ campaignId: "1", campaign: "TvH1-06" }] },
    { id: "u3", name: "Lama", deletedAt: "2026-08-01", campaigns: [{ campaignId: "9", campaign: "X" }] },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["u1__1", "u2__1"]);
  assert.deepEqual(rows.map((row) => row.owner), ["Nurjaman", "aldi@r.live"]);
  assert.equal(rows[0].userId, "u1");
  assert.equal(rows[0].command.state, "pending");
  assert.equal(rows[1].command, null);
});

test("sumber pemetaan disebut apa adanya", () => {
  assert.equal(describeMappingSource({ subDomainSource: "manual" }), "Dipetakan manual");
  assert.equal(describeMappingSource({ subDomain: "a.b", campaignCode: "tvh1" }), "Otomatis dari kode tvh1");
  assert.equal(
    describeMappingSource({ campaignCode: "npjl" }),
    "Kode npjl belum terdaftar di subdomain manapun",
  );
});
