// Gating campaign Keitaro — sisi UI-nya.
//
// Tombol Gate/Ungate TIDAK memanggil vi-control. Ia menulis niat ke
// `dashboard/gating/commands/{key}`, dan yang memanggil API adalah penerap di sisi server
// (functions/sync-gating.mjs). Bentuk perintahnya harus sama persis dengan `gateCommandEntry` di
// functions/gating-core.js; kalau berbeda, perintahnya lolos aturan database tapi tidak pernah
// dieksekusi siapa pun — persis seperti campaignCommandEntry.
//
// Kenapa antrean dan bukan panggilan langsung, dan ini alasan yang LEBIH KERAS daripada di saklar
// campaign: API key vi-control bisa mengubah tujuan trafik iklan yang sedang berjalan. Ditaruh di
// bundle supaya browser bisa memanggil API-nya sendiri, ia terbaca siapa pun yang membuka devtools.
// Jadi bahkan kalau DRS dilonggarkan besok dan callable bisa dipanggil, key-nya tetap tinggal di
// sisi server.

export const GATE_ACTIONS = ["gate", "ungate"];

export function gateKey(campaignId) {
  return `c${String(campaignId).trim()}`;
}

export function gateCommandEntry(campaign, action, actor, now = new Date()) {
  if (!GATE_ACTIONS.includes(action)) {
    throw new Error(`Aksi gating tidak dikenal: ${action}`);
  }

  const campaignId = String(campaign?.campaignId ?? campaign?.id ?? "").trim();
  if (!/^\d+$/.test(campaignId)) {
    throw new Error("Campaign ini tidak punya ID Keitaro yang bisa dipakai.");
  }

  return {
    campaignId,
    campaign: String(campaign?.name || campaign?.campaign || "").slice(0, 300),
    action,
    state: "pending",
    requestedAt: now.toISOString(),
    requestedBy: actor || "dashboard",
    error: null,
  };
}

// RTDB mengembalikan node kosong sebagai null, dan bentuk yang tidak dikenal tidak boleh
// menjatuhkan seluruh halaman.
export function toMap(value) {
  return value && typeof value === "object" ? value : {};
}

// Blocker disimpan sebagai objek berkunci urutan (RTDB membuang array kosong), jadi urutannya
// dikembalikan lewat kuncinya sendiri — bukan lewat urutan Object.keys, yang tidak dijamin untuk
// kunci non-numerik.
export function toBlockerList(preview) {
  return Object.entries(toMap(preview?.blockers))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, value]) => String(value))
    .filter(Boolean);
}

export function hostOf(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  try {
    return new URL(text).host;
  } catch {
    return text;
  }
}

const GATED_LABELS = {
  true: "Lewat gate",
  false: "Langsung",
};

/**
 * Baris tabel: cermin campaign digabung dengan pratinjau dan perintah yang sedang menunggu.
 *
 * `gated` tetap bertiga nilai sampai ke layar. `null` berarti stream campaign itu gagal dibaca di
 * sisi Keitaro — TIDAK DIKETAHUI, bukan "belum di-gate". Dipetakan jadi "Langsung", halaman akan
 * menawarkan tombol Gate untuk campaign yang mungkin sudah di-gate, dan menekannya memasang gate di
 * depan gate.
 */
export function toGateRows(campaigns, previews, commands) {
  const previewMap = toMap(previews);
  const commandMap = toMap(commands);

  return Object.entries(toMap(campaigns))
    .map(([key, campaign]) => {
      if (!campaign) return null;
      const preview = previewMap[key] || null;
      const command = commandMap[key] || null;
      const gated = campaign.gated === true ? true : campaign.gated === false ? false : null;

      return {
        id: key,
        campaignId: String(campaign.campaignId || ""),
        name: campaign.name || "",
        alias: campaign.alias || "",
        state: campaign.state || "",
        gated,
        gatedLabel: GATED_LABELS[String(gated)] || "Tidak diketahui",
        landingUrl: campaign.landingUrl || "",
        decoyUrl: campaign.decoyUrl || "",
        landingHost: hostOf(campaign.landingUrl),
        decoyHost: hostOf(campaign.decoyUrl),
        preview,
        blockers: toBlockerList(preview),
        command,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right.campaignId) - Number(left.campaignId));
}

/**
 * Keadaan tombol untuk satu baris: aksi apa yang akan dijalankan, boleh ditekan atau tidak, dan
 * kalimat yang menjelaskan kenapa.
 *
 * Yang menentukan arah tombol adalah `gated` dari daftar campaign, BUKAN `applicable` dari
 * pratinjau. Pratinjau untuk campaign yang sudah di-gate tetap menjawab `applicable: true`, dengan
 * tujuan yang menunjuk ke URL gate itu sendiri — tombol yang membacanya akan menawarkan "Gate"
 * untuk campaign yang sudah lewat gate, dan menekannya memasang gate di depan gate.
 */
export function gateActionState(row, { canGate = false } = {}) {
  const command = row?.command;
  const pending = command?.state === "pending";
  const failed = command?.state === "failed";
  const action = row?.gated === true ? "ungate" : "gate";
  const label = action === "ungate" ? "Ungate" : "Gate";

  if (!canGate) {
    return {
      action,
      label,
      disabled: true,
      pending,
      failed,
      reason: "Hanya superadmin yang boleh menjalankan gating.",
    };
  }

  if (pending) {
    return {
      action: command.action,
      label: command.action === "ungate" ? "Ungate" : "Gate",
      disabled: true,
      pending: true,
      failed: false,
      reason:
        command.action === "ungate"
          ? "Menunggu dikembalikan ke URL langsungnya."
          : "Menunggu dijalankan di Keitaro.",
    };
  }

  // Tidak diketahui bukan "belum di-gate". Tombolnya dimatikan berikut alasannya, bukan digambar
  // seolah campaign-nya siap di-gate.
  if (row?.gated === null || row?.gated === undefined) {
    return {
      action: "",
      label: "Gate",
      disabled: true,
      pending: false,
      failed,
      reason:
        "Status gating campaign ini tidak terbaca dari Keitaro — tunggu penyegaran berikutnya.",
    };
  }

  if (action === "ungate") {
    // Ungate tidak punya pratinjau di API-nya, dan memang tidak perlu: yang dikembalikan adalah
    // keadaan sebelum gating, yang sudah tersimpan di sisi vi-control.
    return { action, label, disabled: false, pending: false, failed, reason: failureNote(command) };
  }

  if (!row?.preview) {
    return {
      action,
      label,
      disabled: true,
      pending: false,
      failed,
      // Pratinjau diambil sisi server tiap penyegaran cermin. Tanpa itu tidak ada blocker yang bisa
      // ditampilkan, dan tombol yang tetap hidup akan menjalankan gating tanpa ada yang melihat
      // apa yang akan berubah — persis yang dilarang catatan integrasi vi-control.
      reason: "Pratinjau belum terbaca — tunggu penyegaran berikutnya.",
    };
  }

  if (!row.preview.applicable) {
    return {
      action,
      label,
      disabled: true,
      pending: false,
      failed,
      reason: row.blockers.join("; ") || "Campaign ini tidak bisa di-gate.",
    };
  }

  // Perintah yang gagal tetap membiarkan tombolnya bisa ditekan: mencoba lagi adalah tindakan yang
  // benar, dan sebabnya sudah tertulis di bawah tombol.
  return { action, label, disabled: false, pending: false, failed, reason: failureNote(command) };
}

function failureNote(command) {
  return command?.state === "failed" ? command.error || "Perintah terakhir gagal." : "";
}

// Ringkasan untuk kartu di atas tabel. `unknown` dihitung terpisah dari `ungated`: selisih itu
// persis yang membedakan "5 campaign siap di-gate" dari "5 campaign tidak terbaca".
export function gateSummary(rows) {
  const list = rows || [];
  return {
    total: list.length,
    gated: list.filter((row) => row.gated === true).length,
    ungated: list.filter((row) => row.gated === false).length,
    unknown: list.filter((row) => row.gated !== true && row.gated !== false).length,
    pending: list.filter((row) => row.command?.state === "pending").length,
    blocked: list.filter((row) => row.gated === false && row.preview && !row.preview.applicable)
      .length,
  };
}

const RUN_TONES = {
  ok: "success",
  // `aborted` BUKAN error kami: tidak ada yang ditulis sama sekali, dan sistemnya sedang melindungi.
  // Diwarnai merah seperti kegagalan, orang akan mengulanginya membabi buta — persis yang diminta
  // catatan integrasi untuk tidak dilakukan.
  aborted: "warning",
  // `problem` justru yang paling gawat: perubahannya TERSIMPAN tapi verifikasinya gagal, jadi
  // routing-nya sudah berubah tanpa terbukti benar.
  problem: "danger",
};

export function gateRunTone(status) {
  return RUN_TONES[String(status || "").toLowerCase()] || "neutral";
}

const RUN_LABELS = {
  ok: "Berhasil",
  aborted: "Ditolak",
  problem: "Perlu dicek",
};

export function gateRunLabel(status) {
  return RUN_LABELS[String(status || "").toLowerCase()] || status || "-";
}

// Riwayat, terbaru dulu. Diurutkan di sini dan bukan dibiarkan mengikuti urutan kunci: kuncinya
// adalah UUID, yang urutannya tidak berarti apa-apa.
export function toGateRunRows(runs) {
  return Object.entries(toMap(runs))
    .map(([id, run]) => (run ? { ...run, id: run.id || id } : null))
    .filter(Boolean)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
}

/**
 * Jawaban server kontrol → satu pesan untuk orang yang menekan tombolnya.
 *
 * Ada tiga status dan ketiganya BERBEDA AKIBATNYA. Ini fungsi yang menjaga bedanya tidak lebur:
 *
 *   ok      — selesai dan terbukti benar.
 *   aborted — DITOLAK, dan tidak ada yang diubah di Keitaro sama sekali. Peringatan, bukan error:
 *             sistemnya sedang melindungi, dan yang perlu dibaca orang adalah alasannya.
 *   problem — perubahannya TERSIMPAN tapi verifikasinya gagal. Ini satu-satunya yang menuntut
 *             seseorang membuka Keitaro; disampaikan sebagai "gagal", ia akan terbaca sebagai
 *             "tidak jadi" dan routing yang sudah berubah itu tidak akan diperiksa siapa pun.
 */
export function gateResultMessage(name, action, result) {
  const status = String(result?.status || "").toLowerCase();
  const done = action === "ungate" ? "dikembalikan ke URL langsungnya" : "di-gate";

  if (status === "ok") {
    return {
      tone: "success",
      message: `${name} sudah ${done}.`,
      // `reload.ok: false` bukan kegagalan: perubahannya tersimpan, gate-nya saja yang belum
      // menyerapnya dan akan membacanya sendiri saat polling.
      note: result?.reloadPending ? "Gate belum memuat ulang site-nya — itu menyusul sendiri." : "",
    };
  }

  if (status === "aborted") {
    return {
      tone: "warning",
      message: `${name}: ditolak — ${result?.error || "tidak ada alasan yang disebutkan."}`,
      note: "Tidak ada yang diubah di Keitaro.",
    };
  }

  if (status === "problem") {
    return {
      tone: "error",
      message: `${name}: perubahannya TERSIMPAN tapi verifikasinya gagal. Periksa manual di Keitaro.`,
      note: result?.runId ? `Run ${result.runId}.` : "",
    };
  }

  return {
    tone: "warning",
    message: `${name}: server menjawab status "${result?.status || "tanpa status"}".`,
    note: "",
  };
}
