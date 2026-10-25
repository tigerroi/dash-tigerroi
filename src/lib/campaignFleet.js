/**
 * Aturan tampilan halaman Campaign (/campaigns) dan dialognya. Murni.
 *
 * Aturan yang MEMUTUSKAN sesuatu (nama boleh atau tidak, targeting bisa diedit atau tidak) tidak
 * tinggal di sini melainkan di server (functions/campaign-manage-core.js): salinan kedua dari aturan
 * yang menolak akan berselisih suatu hari, dan yang lebih longgar menang tanpa berbunyi. Dialog
 * mengirim lalu menggambar penolakan server apa adanya.
 */

export const UNMAPPED_FILTER = "-";
const ACTIVE_JOB = new Set(["requested", "running"]);
const TERMINAL_JOB = new Set(["done", "partial", "failed", "unknown"]);
// Kalimat panel bisa memuat pesan Meta utuh (sampai 1000 karakter). Di atas batas ini toast menyuruh
// melihat panelnya alih-alih memotong kalimatnya: potongan di tengah justru membuang ekornya, dan di
// situlah tindakan yang harus diambil tertulis ("beri izin beriklan di Halaman itu").
const MAX_TOAST_REASON = 120;
const byText = (a, b) => String(a).localeCompare(String(b), "id-ID", { numeric: true });

export function filterFleetRows(
  rows,
  { q = "", owner = "", account = "", subDomain = "", status = "" } = {},
) {
  const term = String(q).trim().toLowerCase();
  return rows.filter((row) => {
    if (term && !`${row.campaign || ""} ${row.campaignCode || ""}`.toLowerCase().includes(term))
      return false;
    if (owner && row.userId !== owner) return false;
    if (account && row.account !== account) return false;
    if (subDomain === UNMAPPED_FILTER) {
      if (row.subDomain) return false;
    } else if (subDomain && row.subDomain !== subDomain) {
      return false;
    }
    if (status && row.status !== status) return false;
    return true;
  });
}

// Diambil dari baris yang ADA, supaya pilihan yang ditawarkan tidak pernah mengosongkan tabel.
export function fleetFilterOptions(rows) {
  const owners = new Map();
  const accounts = new Set();
  const subDomains = new Set();
  const statuses = new Set();
  for (const row of rows) {
    owners.set(row.userId, row.owner);
    if (row.account && row.account !== "-") accounts.add(row.account);
    if (row.subDomain) subDomains.add(row.subDomain);
    if (row.status) statuses.add(row.status);
  }
  return {
    owners: [...owners]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => byText(a.label, b.label)),
    accounts: [...accounts].sort(byText),
    subDomains: [...subDomains].sort(byText),
    statuses: [...statuses].sort(byText),
  };
}

// Posisi SAKLAR, bukan label: "Terjadwal" dan "Aktif" sama-sama On.
export function sortFleetRows(rows) {
  const rank = (row) =>
    row.configuredStatus === "ACTIVE" ? 0 : row.configuredStatus === "PAUSED" ? 1 : 2;
  return [...rows].sort((a, b) => rank(a) - rank(b) || byText(a.campaign || "", b.campaign || ""));
}

const JOB_LABELS = {
  requested: ["Berjalan", "info"],
  running: ["Berjalan", "info"],
  done: ["Selesai", "success"],
  partial: ["Sebagian", "warning"],
  unknown: ["Tidak diketahui", "warning"],
  failed: ["Gagal", "danger"],
};

function listOf(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : Object.values(value)).filter(
    (item) => item !== null && item !== undefined,
  );
}

export function copyJobRows(jobs) {
  const entries = jobs && typeof jobs === "object" ? Object.entries(jobs) : [];
  return entries
    .map(([id, job]) => {
      const copies = listOf(job?.copies);
      const names = listOf(job?.names);
      const [label, tone] = JOB_LABELS[job?.state] || JOB_LABELS.unknown;
      return {
        id,
        state: job?.state || "",
        label,
        tone,
        sourceCampaignId: String(job?.sourceCampaignId || ""),
        sourceName: job?.sourceName || "",
        names,
        count: Number(job?.count) || names.length,
        born: copies.filter((copy) => copy?.campaignId).length,
        // Iklan dijumlahkan lintas salinan: itu yang membedakan salinan yang campaign-nya lahir
        // tapi kosong (app Development Mode / izin Halaman) dari salinan yang benar-benar utuh, dan
        // satu-satunya angka yang menerangkan kenapa sebuah job berbunyi "Sebagian".
        ads: copies.reduce((sum, copy) => sum + (Number(copy?.ads) || 0), 0),
        adsExpected: copies.reduce((sum, copy) => sum + (Number(copy?.adsExpected) || 0), 0),
        renameErrors: copies.filter((copy) => copy?.renameError).length,
        error: job?.error || "",
        progress: {
          done: Number(job?.progress?.done) || 0,
          total: Number(job?.progress?.total) || 0,
        },
        requestedBy: job?.requestedBy || "",
        requestedAt: job?.requestedAt || "",
      };
    })
    .sort((a, b) => byText(b.requestedAt, a.requestedAt));
}

/**
 * Job BUAT campaign, dibaca dari node-nya sendiri.
 *
 * Yang lahir dihitung dari `adSets` — iklan yang benar-benar punya `adId`, bukan jumlah ad set: ad
 * set yang berdiri tanpa iklan adalah persis keadaan yang ditinggalkan app Development Mode, dan
 * menghitungnya sebagai "lahir" membuat panelnya berbunyi selesai untuk campaign yang tidak punya
 * satu pun iklan.
 */
function createJobRows(jobs) {
  const entries = jobs && typeof jobs === "object" ? Object.entries(jobs) : [];
  return entries.map(([id, job]) => {
    const adSets = listOf(job?.adSets);
    const [label, tone] = JOB_LABELS[job?.state] || JOB_LABELS.unknown;
    return {
      id,
      kind: "create",
      kindLabel: "Buat",
      state: job?.state || "",
      label,
      tone,
      sourceCampaignId: "",
      title: job?.name || "-",
      subtitle: job?.subDomain ? `ke ${job.subDomain}` : "",
      accountName: job?.accountName || "",
      campaignId: String(job?.campaignId || ""),
      born: adSets.filter((row) => row?.adId).length,
      count: Number(job?.variants) || adSets.length,
      // Job lama tidak membawa rencananya, jadi tidak ada yang bisa dilanjutkan tanpa mengisi ulang
      // form. Yang lain-lain (jadwal lewat, gagal tidak pasti) diputuskan server saat ditekan.
      resumable: job?.state === "partial" && Boolean(job?.plan),
      error: job?.error || "",
      progress: {
        done: Number(job?.progress?.done) || 0,
        total: Number(job?.progress?.total) || 0,
      },
      requestedBy: job?.requestedBy || "",
      requestedAt: job?.requestedAt || "",
      searchName: job?.name || "",
    };
  });
}

/**
 * Kedua jenis job dalam SATU daftar, terbaru dulu.
 *
 * Satu panel, bukan dua: pertanyaan yang dibawa orang ke halaman ini cuma "apa yang sedang berjalan",
 * dan jawaban yang dipecah dua daftar menuntut dua tempat dilihat untuk menjawabnya.
 */
export function campaignJobRows(copyJobs, createJobs) {
  const copies = copyJobRows(copyJobs).map((job) => ({
    ...job,
    kind: "copy",
    kindLabel: "Salin",
    title: `${job.names[0] || "-"}${job.count > 1 ? ` (+${job.count - 1})` : ""}`,
    subtitle: `dari ${job.sourceName || "-"}`,
    searchName: (job.names[0] || "").replace(/ #\d+$/, ""),
  }));
  return [...copies, ...createJobRows(createJobs)].sort((a, b) =>
    byText(b.requestedAt, a.requestedAt),
  );
}

// Kalimat di bawah pil status, untuk baris panel jenis apa pun.
export function campaignJobNote(row) {
  if (row.kind === "copy") return copyJobNote(row);
  if (ACTIVE_JOB.has(row.state)) {
    return row.progress?.total
      ? `Membuat iklan ${row.progress.done} dari ${row.progress.total}.`
      : "Sedang disiapkan.";
  }
  if (row.state === "unknown" && !row.error) {
    return "Server tidak tahu apakah campaign-nya sudah lahir — periksa Ads Manager sebelum membuat lagi.";
  }
  return row.error;
}

export function copyJobNote(job) {
  if (ACTIVE_JOB.has(job.state)) {
    // Salinan berjalan bertahap di server: campaign dulu, lalu tiap ad set ke dalamnya.
    return job.progress?.total
      ? `Menyalin ad set ${job.progress.done} dari ${job.progress.total}.`
      : "Sedang disiapkan.";
  }
  if (job.state === "done") {
    // Job lama: sejak ganti nama yang gagal membuat salinan `partial`, sebabnya ada di `error`.
    return job.renameErrors
      ? `${job.renameErrors} salinan belum berganti nama — ubah lewat tombol Ubah.`
      : "";
  }
  // `unknown` tanpa kalimat tetap harus menyuruh memeriksa: "gagal" di sana membuat orang menyalin
  // lagi, dan salinan yang ternyata sudah lahir tidak bisa ditarik kembali.
  if (job.state === "unknown" && !job.error) {
    return "Server tidak tahu apakah salinannya sudah lahir — periksa Ads Manager sebelum menyalin lagi.";
  }
  return job.error;
}

/**
 * Isi form ubah ad set dan apa yang benar-benar berubah.
 *
 * `edits` adalah nilai yang DIKETIK orang (`null` = kotak belum disentuh). Umur hanya dihitung
 * berubah kalau kotaknya disentuh: Meta tidak selalu mengirim `age_min`/`age_max`, dan angka 18/65
 * yang digambar sebagai isian bawaan bukan perubahan — tanpa aturan ini, menyimpan nama saja ikut
 * mengirim targeting.
 */
export function adSetEditState(current, edits = {}) {
  const targeting = current?.targeting;
  const values = {
    name: edits.name ?? current?.name ?? "",
    budget: edits.budget ?? current?.dailyBudget ?? "",
    countries: edits.countries ?? (targeting?.countries || []).join(", "),
    ageMin: edits.ageMin ?? targeting?.ageMin ?? 18,
    ageMax: edits.ageMax ?? targeting?.ageMax ?? 65,
  };
  const countries = parseCountryInput(values.countries);
  const changes = {};
  const lines = [];
  if (current && values.name.trim() && values.name.trim() !== current.name) {
    changes.name = values.name.trim();
  }
  if (current?.budget?.editable && String(values.budget) !== String(current.dailyBudget)) {
    changes.dailyBudget = Number(values.budget);
    lines.push(`Anggaran harian: ${budgetChangeNote(current.dailyBudget, changes.dailyBudget)}`);
  }
  if (targeting?.editable) {
    if (!sameCountries(countries, targeting.countries)) {
      changes.countries = countries;
      lines.push(
        `Negara: ${targeting.countries.join(", ")} → ${countries.join(", ") || "(kosong)"}`,
      );
    }
    const touched = (value) => value !== null && value !== undefined;
    if (touched(edits.ageMin) && Number(edits.ageMin) !== targeting.ageMin) {
      changes.ageMin = Number(edits.ageMin);
    }
    if (touched(edits.ageMax) && Number(edits.ageMax) !== targeting.ageMax) {
      changes.ageMax = Number(edits.ageMax);
    }
    if (changes.ageMin !== undefined || changes.ageMax !== undefined) {
      lines.push(
        `Umur: ${targeting.ageMin ?? 18}–${targeting.ageMax ?? 65} → ${values.ageMin}–${values.ageMax}`,
      );
    }
  }
  return { values, countries, changes, lines, changed: Object.keys(changes).length > 0 };
}

// Isian awal nama salinan: BUKAN nama sumbernya — sync melebur campaign bernama sama di satu akun
// jadi satu baris, dan server menolaknya. Kode Keitaro sumber tetap di dalamnya, jadi vonis namanya
// tetap lolos.
export function copyDefaultName(row) {
  return `${row?.campaign || ""} (salinan)`;
}

export function runningCopyFor(jobs, campaignId) {
  return jobs.some(
    (job) =>
      job.kind !== "create" &&
      ACTIVE_JOB.has(job.state) &&
      job.sourceCampaignId === String(campaignId),
  );
}

const regionNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["id"], { type: "region" })
    : null;

export function countryLabel(code) {
  try {
    return regionNames?.of(code) || code;
  } catch {
    return code;
  }
}

export function parseCountryInput(text) {
  return [
    ...new Set(
      String(text || "")
        .split(/[\s,]+/)
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function sameCountries(a, b) {
  const key = (list) => [...list].map(String).sort().join(",");
  return key(a) === key(b);
}

function formatIdr(amount) {
  return `Rp ${Math.round(Number(amount) || 0).toLocaleString("id-ID")}`;
}

export function budgetChangeNote(before, after) {
  const from = Number(before);
  const to = Number(after);
  if (!(from > 0)) return formatIdr(to);
  const percent = ((to - from) / from) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${formatIdr(from)} → ${formatIdr(to)} (${sign}${percent.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)`;
}

// --- Toast hasil pekerjaan ---------------------------------------------------------------------

/**
 * Apa yang lahir, sebagai satu potongan kalimat.
 *
 * Untuk job salin, IKLAN disebut terpisah dari campaign-nya — dan itu yang menerangkan "Sebagian":
 * campaign salinan hampir selalu lahir, yang kurang isinya. Job lama (yang barisnya ditulis sebelum
 * hitungan iklan ada) tidak menyebut iklan sama sekali alih-alih melaporkan nol untuk iklan yang
 * sebenarnya lahir.
 */
function jobTally(job, withTotal) {
  const unit = job.kind === "copy" ? "campaign" : "iklan";
  const head = withTotal ? `${job.born} dari ${job.count} ${unit}` : `${job.born} ${unit}`;
  if (job.kind !== "copy" || !job.adsExpected) return `${head} lahir`;
  return `${head}, ${withTotal ? `${job.ads} dari ${job.adsExpected} iklan` : `${job.ads} iklan`} lahir`;
}

/**
 * Berapa pekerjaan yang sedang berjalan — lencana di tab Pekerjaan.
 *
 * Dihitung dari node-nya langsung, bukan dari `campaignJobRows`: ia dipanggil tiap render di
 * main.jsx (sepola `pendingChats`), dan merakit seluruh baris kedua node untuk satu angka berarti
 * pekerjaan yang sama dilakukan dua kali di tiap muat halaman yang bukan halaman Campaign.
 */
export function runningJobCount(copyJobs, createJobs) {
  let running = 0;
  for (const node of [copyJobs, createJobs]) {
    if (!node || typeof node !== "object") continue;
    for (const job of Object.values(node)) {
      if (ACTIVE_JOB.has(job?.state)) running++;
    }
  }
  return running;
}

/** Status tiap job, bahan pembanding untuk snapshot berikutnya. */
export function jobStateMap(jobs) {
  const map = {};
  for (const job of jobs || []) map[job.id] = job.state;
  return map;
}

/**
 * Toast untuk job yang BARU SAJA selesai — satu per perpindahan, bukan satu per pembacaan.
 *
 * Hasil duplikasi tidak bisa diumumkan tombolnya: route menjawab sesudah job ditulis `requested` dan
 * sebelum satu ad set pun disalin (penyalinannya di latar, lihat server/campaign-manage.js). Jadi
 * yang mengabarkannya adalah node job yang SUDAH dilanggan panel Pekerjaan, dan yang dibandingkan
 * status job pada pembacaan sebelumnya.
 *
 * `before` KOSONG (null) berarti pembacaan pertama sesi ini: tidak ada satu pun toast. Node job
 * menyimpan tujuh hari riwayat, jadi tanpa aturan itu membuka halaman ini memuntahkan selusin toast
 * tentang pekerjaan yang sudah lama selesai. Job yang muncul PERTAMA KALI sudah dalam keadaan selesai
 * juga tidak ditoast — ia bukan pekerjaan yang kita saksikan berjalan, dan satu-satunya yang bisa
 * dikabarkan tentangnya adalah bahwa ia ada.
 */
export function finishedJobToasts(before, jobs) {
  if (!before) return [];
  const toasts = [];
  for (const job of jobs || []) {
    const was = before[job.id];
    if (!ACTIVE_JOB.has(was) || !TERMINAL_JOB.has(job.state)) continue;
    const subject = job.kind === "copy" ? `Salinan "${job.title}"` : `Campaign "${job.title}"`;
    const note = campaignJobNote(job);
    const reason = note.length > MAX_TOAST_REASON ? "Sebabnya ada di panel Pekerjaan." : note;
    const head =
      job.state === "done"
        ? `${subject} selesai — ${jobTally(job, false)}.`
        : job.state === "partial"
          ? `${subject} selesai sebagian — ${jobTally(job, true)}.`
          : job.state === "unknown"
            ? `${subject} hasilnya tidak pasti.`
            : `${subject} gagal.`;
    toasts.push({
      id: job.id,
      state: job.state,
      tone: job.state === "done" ? "success" : "warning",
      message: [head, reason].filter(Boolean).join(" "),
    });
  }
  return toasts;
}

/**
 * Tindakan massal di tabel armada: satu tulisan ke Meta per campaign, BERURUTAN.
 *
 * Berurutan dan bukan paralel: yang membuat sebuah app dicap anomali adalah bentuk request-nya, dan
 * puluhan tulisan yang meletus bersamaan adalah persis bentuk itu. Satu yang ditolak tidak
 * menghentikan sisanya, dan yang ditolak disebut berikut sebabnya.
 */
export async function runEach(rows, task) {
  const failed = [];
  let done = 0;
  for (const row of rows) {
    try {
      await task(row);
      done += 1;
    } catch (error) {
      failed.push({ name: row.campaign, message: error?.message || String(error) });
    }
  }
  return { done, failed };
}

// Satu kalimat untuk toast hasil tindakan massal. Yang gagal disebut namanya — sampai tiga, sisanya
// dihitung, supaya toast-nya tidak sepanjang daftar yang baru dipilih.
export function bulkResultMessage(verb, { done, failed }) {
  const head = `${verb} ${done} dari ${done + failed.length} campaign.`;
  if (!failed.length) return head;
  const named = failed
    .slice(0, 3)
    .map((item) => `${item.name}: ${item.message}`)
    .join("; ");
  const rest = failed.length > 3 ? ` (+${failed.length - 3} lainnya)` : "";
  return `${head} Gagal — ${named}${rest}`;
}
