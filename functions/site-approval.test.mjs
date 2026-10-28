import assert from "node:assert/strict";
import { collectSiteApprovals, siteApprovalLabel, siteApprovalUpdates } from "./site-approval.js";

// --- Label ------------------------------------------------------------------------------------
// Kosakata tiap konsol dipertahankan: "Disetujui" milik Ad Manager, "Siap" milik AdSense.
assert.equal(siteApprovalLabel("gam", { approvalStatus: "APPROVED" }), "Disetujui");
assert.equal(siteApprovalLabel("gam", { approvalStatus: "DISAPPROVED" }), "Ditolak");
assert.equal(siteApprovalLabel("gam", { approvalStatus: "REQUIRES_REVIEW" }), "Perlu Review");
assert.equal(siteApprovalLabel("adsense", { state: "READY" }), "Siap");
assert.equal(siteApprovalLabel("adsense", { state: "NEEDS_ATTENTION" }), "Perlu Tindakan");

// AdSense mengosongkan `state` untuk tiap SUBDOMAIN — diperiksa ke API produksi: satu akun
// dengan 11 situs menjawab READY hanya untuk domain induknya. Itu bukan status buruk, melainkan
// tidak ada status; kolomnya harus "-", bukan tebakan.
assert.equal(siteApprovalLabel("adsense", { domain: "puppy.petcins.com" }), "");
assert.equal(siteApprovalLabel("gam", {}), "");
assert.equal(siteApprovalLabel("gam", { approvalStatus: "APPROVAL_STATUS_UNSPECIFIED" }), "");

// Enum yang belum ada di peta lolos apa adanya. Nama enum kedua API ini berbeda antar tipe
// network dan bisa bertambah; status baru yang hilang diam-diam terlihat persis sama dengan
// situs yang belum pernah direview.
assert.equal(siteApprovalLabel("gam", { approvalStatus: "SOMETHING_NEW" }), "SOMETHING_NEW");

// --- Kumpulan per host ------------------------------------------------------------------------
const byHost = new Map();
collectSiteApprovals(
  [
    { host: "petcins.com", approval: "Disetujui", approvedAt: "2025-09-24T18:59:25Z" },
    { host: "stylefemale.com", approval: "Disetujui", approvedAt: "" },
  ],
  byHost,
);
// Domain yang sama terdaftar di akun kedua (network GAM-nya sendiri DAN akun AdSense yang
// memonetisasi subdomainnya). Yang pertama menjawab dipertahankan — kalau tidak, kolomnya
// berubah tiap kali urutan akun berubah.
collectSiteApprovals([{ host: "petcins.com", approval: "Siap", approvedAt: "" }], byHost);
assert.equal(byHost.get("petcins.com").approval, "Disetujui");
assert.equal(byHost.get("petcins.com").approvedAt, "2025-09-24T18:59:25Z");

// --- Perubahan yang ditulis -------------------------------------------------------------------
const domains = {
  d1: { domainUrl: "petcins.com" },
  d2: { domainUrl: "stylefemale.com", adApproval: "Disetujui" },
  d3: { domainUrl: "belum-terhubung.com", adApproval: "Perlu Review" },
  d4: { domainUrl: "tidak-pernah-ada.com" },
  d5: { domainUrl: "dihapus.com", deletedAt: "2026-08-01", adApproval: "Disetujui" },
};

const updates = Object.fromEntries(siteApprovalUpdates(domains, byHost, true));
assert.deepEqual(updates.d1, { adApproval: "Disetujui", adApprovalAt: "2025-09-24T18:59:25Z" });
assert.equal("d2" in updates, false, "sudah sama — tidak ditulis ulang tiap sync");
// Semua akun berhasil dibaca dan domain ini tetap tidak muncul: statusnya DIKOSONGKAN, bukan
// diisi "tidak terdaftar". Domain bisa dimonetisasi lewat akun yang belum dihubungkan ke
// dashboard, dan status basi minggu lalu lebih menyesatkan daripada sel kosong.
assert.deepEqual(updates.d3, { adApproval: null, adApprovalAt: null });
assert.equal("d4" in updates, false, "tidak punya status dan tidak pernah punya — diam saja");
assert.equal("d5" in updates, false, "domain terhapus tidak disentuh");

// Satu akun gagal dibaca -> run ini kehilangan hak menyimpulkan apa pun dari ketiadaan, persis
// aturan campaign yang hilang di sync-meta: "tidak dikembalikan" hanya berarti sesuatu kalau
// memang diminta DAN dijawab.
const partial = Object.fromEntries(siteApprovalUpdates(domains, byHost, false));
assert.equal("d3" in partial, false, "tidak dikosongkan hanya karena satu akun gagal");
assert.deepEqual(partial.d1, { adApproval: "Disetujui", adApprovalAt: "2025-09-24T18:59:25Z" });

// Tanggal hanya ada di sisi GAM; tanpa itu field-nya null, bukan string kosong yang menempel di
// RTDB sebagai nilai.
const noDate = Object.fromEntries(
  siteApprovalUpdates(
    { x: { domainUrl: "stylefemale.com" } },
    new Map([["stylefemale.com", { approval: "Siap", approvedAt: "" }]]),
    true,
  ),
);
assert.deepEqual(noDate.x, { adApproval: "Siap", adApprovalAt: null });

console.log("site approval tests ok");
