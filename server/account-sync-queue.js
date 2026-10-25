/**
 * Antrean sync per ad account sesudah campaign diubah dari halaman Campaign.
 *
 * Penyegaran dua menitan cuma memperbarui status/jadwal/anggaran baris yang SUDAH ada — campaign
 * salinan dan nama baru baru tampil lewat `syncCampaigns`. Sync itu berat (tujuan optimasi,
 * insights, riwayat), jadi beberapa tulisan ke satu akun dalam satu jeda dibayar SATU sync.
 */
export function createAccountSyncQueue({
  run,
  lock,
  delayMs = 30_000,
  log = console,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const pending = new Set();
  let timer = null;

  const flush = async () => {
    if (timer) clearTimer(timer);
    timer = null;
    if (!pending.size) return { ids: [] };
    const ids = [...pending];
    pending.clear();
    try {
      await lock.run(() => run(ids));
    } catch (error) {
      // Perubahannya sudah ada di Meta; sync per jam yang membawanya ke tabel.
      log.error(`[campaign] sync akun ${ids.join(", ")} gagal: ${error.message}`);
    }
    return { ids };
  };

  return {
    enqueue(accountId) {
      const id = String(accountId || "").trim();
      if (!id) return;
      pending.add(id);
      if (!timer) timer = setTimer(() => flush(), delayMs);
    },
    flush,
    size: () => pending.size,
  };
}
