/**
 * Penjaga tumpang-tindih untuk tulisan ke `users/{id}/campaigns`.
 *
 * Dua penulisnya — penyegaran status dua menitan dan sync akun sesudah campaign diubah dari
 * halaman Campaign — tidak boleh berjalan bersamaan: yang satu menulis baris yang barusan dibaca
 * yang lain. `tryRun` untuk cron (lewati siklus kalau sibuk), `run` untuk antrean sync (tunggu).
 */
export function createLock() {
  let active = 0;
  let tail = Promise.resolve();

  const run = (task) => {
    const result = tail.then(async () => {
      active++;
      try {
        return await task();
      } finally {
        active--;
      }
    });
    tail = result.catch(() => {});
    return result;
  };

  return {
    run,
    tryRun: (task) => (active > 0 ? null : run(task)),
    isBusy: () => active > 0,
  };
}
