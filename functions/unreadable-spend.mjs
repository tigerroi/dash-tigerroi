import {
  unreadableActIds,
  unreadableEarningByDate,
  unreadableEarningDomains,
  unreadableSpendRows,
  userReportsPath,
} from "./sync-core.js";

// I/O untuk `unreadableSpendRows` (aturannya di sync-core.js): riwayat campaign tiap user, DIBATASI
// rentang tanggal. `userReports` adalah node terberat di database ini, dan yang dibutuhkan cuma
// beberapa hari terakhir milik akun yang sudah tidak terbaca — kunci riwayatnya berawalan tanggal,
// jadi jendelanya bisa diminta ke server alih-alih diunduh utuh lalu disaring.
//
// Tidak ada akun yang tidak terbaca = tidak ada satu bacaan pun.
export async function loadUnreadableSpend(store, { adAccounts, users, since, until }) {
  const actIds = unreadableActIds(adAccounts);
  if (!actIds.size) return [];
  const histories = await Promise.all(
    Object.keys(users || {}).map((userId) =>
      store.readFrom(`${userReportsPath(userId)}/campaignHistory`, since),
    ),
  );
  return unreadableSpendRows(histories, actIds, since, until);
}

// I/O untuk `unreadableEarningByDate`: baris ROI rentang itu saja (kuncinya berawalan tanggal),
// dan hanya kalau ada domain yang seluruh akun earning-nya dimatikan.
export async function loadUnreadableEarning(store, { gamAccounts, adsenseAccounts, since, until }) {
  const domains = unreadableEarningDomains(gamAccounts, adsenseAccounts);
  if (!domains.size) return new Map();
  const [roiReports, subDomains] = await Promise.all([
    store.readFrom("dashboard/roiReports", since),
    store.read("subDomains"),
  ]);
  return unreadableEarningByDate(roiReports, subDomains, domains, since, until);
}
