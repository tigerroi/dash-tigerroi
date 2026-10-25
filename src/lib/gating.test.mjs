import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GATE_ACTIONS,
  gateActionState,
  gateCommandEntry,
  gateResultMessage,
  gateRunLabel,
  gateRunTone,
  gateSummary,
  hostOf,
  toBlockerList,
  toGateRows,
  toGateRunRows,
} from "./gating.js";

describe("gating", () => {
  test("bentuk perintah sama persis dengan sisi functions", () => {
    const entry = gateCommandEntry(
      { campaignId: "36", name: "NUR T2 TBZ 1233" },
      "gate",
      "dev@rabbitracing.live",
      new Date("2026-08-17T10:00:00Z"),
    );
    // Beda satu field dari `gateCommandEntry` di functions/gating-core.js, perintahnya lolos aturan
    // database tapi tidak pernah dieksekusi siapa pun.
    assert.deepEqual(entry, {
      campaignId: "36",
      campaign: "NUR T2 TBZ 1233",
      action: "gate",
      state: "pending",
      requestedAt: "2026-08-17T10:00:00.000Z",
      requestedBy: "dev@rabbitracing.live",
      error: null,
    });
    assert.deepEqual(GATE_ACTIONS, ["gate", "ungate"]);
    assert.throws(() => gateCommandEntry({ campaignId: "36" }, "hapus"), /Aksi gating/);
    assert.throws(() => gateCommandEntry({ name: "tanpa id" }, "gate"), /ID Keitaro/);
  });

  test("baris tabel menggabungkan cermin, pratinjau, dan antrean", () => {
    const rows = toGateRows(
      {
        c57: { campaignId: "57", name: "ALDI", gated: true, landingUrl: "https://go.rabbitracing.live?t=1" },
        c36: { campaignId: "36", name: "NUR", gated: false },
        c44: { campaignId: "44", name: "WL", gated: null },
      },
      { c36: { applicable: true, blockers: {} } },
      { c36: { action: "gate", state: "pending" } },
    );

    // Urut ID menurun: yang baru dibuat di Keitaro adalah yang paling mungkin dicari.
    assert.deepEqual(rows.map((r) => r.campaignId), ["57", "44", "36"]);
    assert.equal(rows[0].gatedLabel, "Lewat gate");
    assert.equal(rows[0].landingHost, "go.rabbitracing.live");
    // `gated: null` tidak boleh runtuh jadi false di mana pun sepanjang jalan ke layar.
    assert.equal(rows[1].gated, null);
    assert.equal(rows[1].gatedLabel, "Tidak diketahui");
    assert.equal(rows[2].command.state, "pending");
    assert.deepEqual(toGateRows(null, null, null), []);
  });

  test("arah tombol ditentukan `gated`, bukan `applicable`", () => {
    // Ini penjaga yang paling penting di halaman ini. Pratinjau untuk campaign yang SUDAH di-gate
    // tetap menjawab applicable:true, dengan tujuan yang menunjuk ke URL gate itu sendiri — tombol
    // yang membacanya akan menawarkan "Gate", dan menekannya memasang gate di depan gate.
    const gated = {
      gated: true,
      preview: { applicable: true },
      blockers: [],
    };
    const state = gateActionState(gated, { canGate: true });
    assert.equal(state.action, "ungate");
    assert.equal(state.disabled, false);
  });

  test("yang tidak diketahui tombolnya mati, bukan ditawari Gate", () => {
    const state = gateActionState({ gated: null, blockers: [] }, { canGate: true });
    assert.equal(state.disabled, true);
    assert.equal(state.action, "");
    assert.match(state.reason, /tidak terbaca/);
  });

  test("blocker mematikan tombol dan menjadi alasannya", () => {
    const row = {
      gated: false,
      preview: { applicable: false },
      blockers: ["expected exactly 1 active landing, found 0"],
    };
    const state = gateActionState(row, { canGate: true });
    assert.equal(state.disabled, true);
    assert.equal(state.reason, "expected exactly 1 active landing, found 0");
  });

  test("tanpa pratinjau, Gate tidak boleh hidup", () => {
    // Catatan integrasi vi-control: selalu panggil preview sebelum gate, dan tampilkan
    // current → willSet beserta blockers. Tombol yang hidup tanpa pratinjau menjalankan gating
    // tanpa ada yang sempat melihat apa yang akan berubah.
    const state = gateActionState({ gated: false, preview: null, blockers: [] }, { canGate: true });
    assert.equal(state.disabled, true);
    assert.match(state.reason, /Pratinjau belum terbaca/);
  });

  test("perintah menunggu memegang tombolnya, yang gagal melepasnya", () => {
    const pending = gateActionState(
      { gated: false, preview: { applicable: true }, blockers: [], command: { action: "gate", state: "pending" } },
      { canGate: true },
    );
    assert.equal(pending.disabled, true);
    assert.equal(pending.pending, true);

    // Mencoba lagi adalah tindakan yang benar, jadi tombolnya tetap bisa ditekan — sebabnya
    // tertulis di bawahnya.
    const failed = gateActionState(
      {
        gated: false,
        preview: { applicable: true },
        blockers: [],
        command: { action: "gate", state: "failed", error: "Keitaro sedang down" },
      },
      { canGate: true },
    );
    assert.equal(failed.disabled, false);
    assert.equal(failed.failed, true);
    assert.equal(failed.reason, "Keitaro sedang down");
  });

  test("tanpa hak, tombolnya mati berikut alasannya", () => {
    const state = gateActionState({ gated: false, preview: { applicable: true }, blockers: [] });
    assert.equal(state.disabled, true);
    assert.match(state.reason, /superadmin/);
  });

  test("ringkasan memisahkan yang tidak terbaca dari yang belum di-gate", () => {
    const summary = gateSummary([
      { gated: true },
      { gated: true },
      { gated: false, preview: { applicable: true } },
      { gated: false, preview: { applicable: false } },
      { gated: null },
      { gated: false, command: { state: "pending" } },
    ]);
    assert.equal(summary.total, 6);
    assert.equal(summary.gated, 2);
    assert.equal(summary.ungated, 3);
    assert.equal(summary.unknown, 1);
    assert.equal(summary.blocked, 1);
    assert.equal(summary.pending, 1);
  });

  test("riwayat terbaru dulu, dan warnanya membedakan ditolak dari perlu dicek", () => {
    const rows = toGateRunRows({
      a: { id: "a", startedAt: "2026-08-17T05:21:22.656Z" },
      b: { id: "b", startedAt: "2026-08-17T05:24:31.293Z" },
    });
    assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);

    assert.equal(gateRunTone("ok"), "success");
    // Ditolak = tidak ada yang ditulis sama sekali; sistemnya sedang melindungi. Merah seperti
    // kegagalan, orang akan mengulanginya membabi buta.
    assert.equal(gateRunTone("aborted"), "warning");
    // Tersimpan tapi verifikasinya gagal — inilah yang benar-benar perlu orang.
    assert.equal(gateRunTone("problem"), "danger");
    assert.equal(gateRunLabel("problem"), "Perlu dicek");
  });

  test("helper kecil", () => {
    assert.deepEqual(toBlockerList({ blockers: { i1: "b", i0: "a" } }), ["a", "b"]);
    assert.deepEqual(toBlockerList(null), []);
    assert.equal(hostOf("https://bowlsharp.com/hr3agan0t?key=x"), "bowlsharp.com");
    // URL Keitaro membawa placeholder berkurung kurawal; yang tidak bisa diurai dikembalikan apa
    // adanya, bukan jadi string kosong yang terbaca seperti data hilang.
    assert.equal(hostOf("bukan url"), "bukan url");
    assert.equal(hostOf(""), "");
  });

  test("tiga status jawaban server tidak boleh lebur jadi satu nada", () => {
    // ok -> hijau.
    const ok = gateResultMessage("NUR T2", "gate", { status: "ok" });
    assert.equal(ok.tone, "success");
    assert.match(ok.message, /sudah di-gate/);

    // `reload.ok: false` bukan kegagalan: perubahannya tersimpan, gate-nya saja yang belum
    // menyerapnya. Tetap sukses, dengan catatan.
    const pending = gateResultMessage("NUR T2", "gate", { status: "ok", reloadPending: true });
    assert.equal(pending.tone, "success");
    assert.match(pending.note, /menyusul sendiri/);

    // aborted -> PERINGATAN, bukan error. Tidak ada yang diubah, dan sistemnya sedang melindungi;
    // diwarnai seperti kegagalan, orang akan mengulanginya membabi buta.
    const aborted = gateResultMessage("WL", "gate", {
      status: "aborted",
      error: "expected exactly 1 active landing, found 0",
    });
    assert.equal(aborted.tone, "warning");
    assert.match(aborted.message, /expected exactly 1 active landing/);
    assert.match(aborted.note, /Tidak ada yang diubah/);

    // problem -> ERROR, dan kalimatnya harus menyebut bahwa perubahannya SUDAH tersimpan. Kalau ia
    // terbaca seperti "tidak jadi", routing yang sudah berubah itu tidak akan diperiksa siapa pun.
    const problem = gateResultMessage("NUR T2", "gate", { status: "problem", runId: "r7" });
    assert.equal(problem.tone, "error");
    assert.match(problem.message, /TERSIMPAN/);
    assert.match(problem.message, /Periksa manual/);
    assert.match(problem.note, /r7/);

    // Status yang tidak dikenal tidak boleh lolos sebagai sukses.
    const weird = gateResultMessage("X", "gate", { status: "hmm" });
    assert.equal(weird.tone, "warning");

    // Ungate memakai kata kerjanya sendiri.
    assert.match(
      gateResultMessage("X", "ungate", { status: "ok" }).message,
      /dikembalikan ke URL langsungnya/,
    );
  });
});