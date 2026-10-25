import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignIndexOf,
  freeMinuteAfter,
  launchCampaignCount,
  launchOwnerEmail,
  launchRows,
  launchSlots,
  shiftPlan,
  wibMinute,
} from "./scheduledLaunches.js";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-18T02:00:00Z"); // 09:00 WIB

const row = (id, offsetMs, pic, extra = {}) => ({
  id,
  adSetId: id,
  accountId: "acc",
  campaignId: `c${id}`,
  campaign: `Campaign ${id}`,
  startMs: T0 + offsetMs,
  startWib: new Date(T0 + offsetMs + 7 * HOUR).toISOString().slice(0, 16),
  pic,
  ...extra,
});

test("semua jam ikut; yang ditandai bentrok hanya jam yang SAMA PERSIS dengan campaign lain", () => {
  const rows = launchRows([
    row("a", 0, "Godek"),
    row("b", 0, "Aca"),
    row("c", 60_000, "Nur"),
    row("d", 30 * 60_000, "Firman"),
  ]);
  const slots = launchSlots(rows);
  assert.deepEqual(
    slots.map((slot) => [slot.minute.slice(11), slot.clash, slot.campaigns.map((item) => item.pic)]),
    [
      ["09:00", true, ["Aca", "Godek"]],
      ["09:01", false, ["Nur"]], // berjeda semenit: tampil, tapi tidak bentrok
      ["09:30", false, ["Firman"]],
    ],
  );
});

test("ad set satu campaign di menit yang sama bukan bentrok, dan campaign PIC yang sama tetap dihitung", () => {
  const own = launchRows([
    row("1", 0, "Rabbit", { campaignId: "X" }),
    row("2", 0, "Rabbit", { campaignId: "X" }),
  ]);
  assert.deepEqual(
    launchSlots(own).map((slot) => slot.clash),
    [false],
  );

  const samePic = launchRows([
    row("1", 0, "Rabbit", { campaignId: "X" }),
    row("2", 0, "Rabbit", { campaignId: "Y" }),
  ]);
  assert.equal(launchSlots(samePic)[0].clash, true);
});

test("tiap campaign menyebut berapa dari ad set-nya yang mulai di menit itu", () => {
  const rows = launchRows([
    row("1", 0, "Godek", { campaignId: "X" }),
    row("2", 0, "Godek", { campaignId: "X" }),
    row("3", 2 * HOUR, "Godek", { campaignId: "X" }),
    row("4", 0, "Aca", { campaignId: "Y" }),
  ]);
  const slot = launchSlots(rows).find((item) => item.clash);
  const x = slot.campaigns.find((item) => item.campaignId === "X");
  assert.equal(x.adSetCount, 2);
  assert.equal(x.adSetTotal, 3);
  assert.equal(launchCampaignCount(rows), 2);
});

test("subdomain dan PIC cadangan dari baris campaign armada", () => {
  const index = campaignIndexOf([
    { campaignId: "ca", subDomain: "care.petcins.com", owner: "Godek" },
    { campaignId: "cb", subDomain: "", owner: "-" },
  ]);
  const rows = launchRows([row("a", 0, ""), row("b", 3 * HOUR, "Aca")], { campaignIndex: index });
  assert.equal(rows[0].pic, "Godek");
  assert.equal(rows[0].subDomain, "care.petcins.com");
  assert.equal(rows[1].pic, "Aca");
});

test("shiftPlan menggeser SELURUH ad set campaign dengan selisih yang sama", () => {
  const rows = launchRows([
    row("a", 0, "Godek", { campaignId: "c1" }),
    row("b", 30 * 60_000, "Godek", { campaignId: "c1" }),
    row("c", 0, "Aca"),
  ]);
  const key = rows[0].campaignKey;
  assert.deepEqual(
    shiftPlan(rows, key, "2026-09-18T09:00", "2026-09-18T10:15").map((item) => item.startTime),
    ["2026-09-18T10:15", "2026-09-18T10:45"],
  );
  assert.deepEqual(shiftPlan(rows, key, "2026-09-18T09:00", ""), []);
});

test("freeMinuteAfter melompati menit yang sudah dipakai kartu lain", () => {
  const slots = [{ minute: "2026-09-18T09:15" }, { minute: "2026-09-18T09:30" }];
  assert.equal(freeMinuteAfter(slots, "2026-09-18T09:00"), "2026-09-18T09:45");
  assert.equal(freeMinuteAfter(slots, "2026-09-18T23:50"), "2026-09-19T00:05");
  assert.equal(wibMinute(T0), "2026-09-18T09:00");
});

test("launchOwnerEmail memakai aturan nama sync dan melewati yang diarsipkan", () => {
  const users = [
    { name: "Godek", email: "lama@x", deletedAt: "2026-01-01" },
    { name: " godek ", email: "g@x" },
  ];
  assert.equal(launchOwnerEmail(users, "GODEK"), "g@x");
  assert.equal(launchOwnerEmail(users, ""), "");
});

test("menit yang sama baru bentrok kalau SERVERNYA sama — yang tidak diketahui dihitung sama", () => {
  const campaignIndex = new Map([
    ["c1", { subDomain: "care.petcins.com" }],
    ["c2", { subDomain: "flash.xiaomi.com" }],
    ["c3", { subDomain: "Tools.Petcins.com" }],
    ["c4", { subDomain: "baru.dekadeko.com" }],
  ]);
  const servers = {
    "care.petcins.com": "10.0.0.1",
    "tools.petcins.com": "10.0.0.1",
    "flash.xiaomi.com": "10.0.0.2",
  };
  const at = (ids) =>
    launchSlots(
      launchRows(
        ids.map((id) => row(id, 0, id, { campaignId: `c${id}` })),
        { campaignIndex },
      ),
      { servers },
    )[0];

  // Dua VPS berbeda: tampil di kartu yang sama, tidak bentrok.
  assert.equal(at(["1", "2"]).clash, false);
  // Mesin yang sama: bentrok, dan yang di VPS lain tidak ikut ditandai.
  const same = at(["1", "2", "3"]);
  assert.equal(same.clash, true);
  assert.equal(same.clashCount, 2);
  assert.deepEqual(
    same.campaigns.map((item) => [item.campaignId, item.server, item.clash]),
    [
      ["c1", "10.0.0.1", true],
      ["c2", "10.0.0.2", false],
      ["c3", "10.0.0.1", true],
    ],
  );
  // Server tidak diketahui: tidak bisa dibuktikan berbeda.
  assert.equal(at(["2", "4"]).clash, true);
  // Peta server gagal dibaca (null): kembali ke aturan menit-sama.
  const unread = launchSlots(
    launchRows([row("1", 0, "a", { campaignId: "c1" }), row("2", 0, "b", { campaignId: "c2" })], {
      campaignIndex,
    }),
    { servers: null },
  );
  assert.equal(unread[0].clash, true);
});
