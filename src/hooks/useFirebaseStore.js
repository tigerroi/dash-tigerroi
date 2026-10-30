import { useCallback, useEffect, useState } from "react";
import { canReadResource, isSuperAdmin, normalizeRole } from "../config/access";
import { FUNCTIONS_ENABLED } from "../config/features";
import { adSetCache, adSetCacheKey } from "../lib/adSetCache";
import { campaignCommandEntry } from "../lib/campaignCommands";
import { countryPresetEntry } from "../lib/campaignCreate";
import {
  CONTROL_API_ENABLED,
  requestRefresh,
  runDiscover,
  runGate,
  setCampaignStatusNow,
} from "../lib/controlApi";
import {
  awaitDiscoverRun,
  createManyResources,
  createResource,
  createResourceAt,
  deleteResource,
  requestGateRefresh,
  subscribeResource,
  subscribeValue,
  updateResource,
  updateResourceFields,
  updateSettings,
  writeCampaignCommand,
  writeGateCommand,
  writeNotificationTopics,
  writeRole,
  writeTarget,
  writeTelegramChatId,
} from "../lib/firebaseRepository";
import { formatDate } from "../lib/formatDate";
import { gateCommandEntry, gateResultMessage } from "../lib/gating";
import { gptTemplateEntry, gptTemplateSizesUpdate } from "../lib/gptInject";
import { needsRoiSnapshots, needsUserReports } from "../lib/heavyData";
import { notifyError, notifySuccess, notifyWarning } from "../lib/notify";
import { completionUpdate, expenseFromReminder } from "../lib/reminders";
import { valueSubscriptionsFor } from "../lib/storeSubscriptions";
import { targetMonthUpdate } from "../lib/targets";
import { createTeamAccount } from "../lib/teamAccounts";
import { detectedContactEntry, dismissUpdate } from "../lib/telegramInbox";

// Callable di balik tombol "Impor dari Google", per jenis data. Jalur KEDUA sejak server kontrol
// memegang impor yang sama: yang ini butuh `allUsers` (diblokir DRS), server kontrol tidak. Tetap
// ada supaya jalur lama tidak mati begitu saja kalau DRS dilonggarkan; kalau dua-duanya tidak ada,
// yang tersisa CLI di functions/ (tools/import-networks.mjs, discover-sites.mjs).
const DISCOVER_CALLABLE = {
  gamAccounts: "importGamNetworks",
  adsenseAccounts: "importAdsenseAccounts",
  domains: "importGamDomains",
  subDomains: "importGamSubdomains",
};

const emptyStore = {
  users: [],
  domains: [],
  subDomains: [],
  adAccounts: [],
  gamAccounts: [],
  adsenseAccounts: [],
  googleApiConfigs: [],
  expenses: [],
  invalidTraffic: [],
  adxCosts: [],
  companyPercents: [],
  bonusPercents: [],
  payouts: [],
  accountCloses: [],
  whitelistTopup: [],
  reminders: [],
  dashboardStats: {},
  weeklyFinancials: [],
  advertiserSpend: [],
  roiReports: [],
  countryRoi: [],
  roiSnapshots: [],
  // Riwayat panel Profile User (campaignHistory, countryRoi, dailySpend, balanceSnapshots), satu
  // cabang per user. Langganan berat seperti roiSnapshots — lihat `needsUserReports`.
  userReports: {},
  domainTargets: {},
  roiSettings: {},
  alertSettings: {},
  notificationGroups: [],
  notificationSettings: {},
  // Chat yang menyapa bot dan belum jadi penerima. Dilanggan admin saja, jadi untuk role lain ia
  // memang tetap kosong seumur sesi — dan panel yang membacanya juga tidak digambar untuk mereka.
  telegramInbox: {},
  syncStatus: {},
  syncRuns: [],
  syncIssues: {},
  syncRetries: {},
  gateCampaigns: {},
  gatePreviews: {},
  gateRuns: {},
  gateCommands: {},
  gateStatus: {},
  pluginSites: {},
  gptSizeTemplates: [],
  adsenseSlots: {},
  cloakingUrls: [],
  campaignCopyJobs: {},
  campaignCreateJobs: {},
  countryPresets: [],
  otpSecrets: [],
};

/**
 * Langganan BERAT — dipasang hanya kalau ada halaman yang benar-benar memakainya, dan sesudah itu
 * dibiarkan hidup sampai sesi berakhir.
 *
 * `dashboard/roiSnapshots` 2,1 MB, unduhan terbesar kedua sesudah `users`, dan yang membacanya cuma
 * dua tab Overview plus panel realtime di profil user (lihat `needsRoiSnapshots`). Ikut di daftar
 * langganan dasar (lib/storeSubscriptions.js), ia terunduh pada muat halaman PERTAMA setiap sesi —
 * termasuk sesi yang cuma membuka Domains lalu tutup.
 *
 * TIDAK dilepas saat orang berpindah tab, dan itu bagian dari rancangannya: RTDB membuang cache
 * sebuah path begitu langganan terakhirnya dicabut, jadi melepas-pasang berarti mengunduh 2,1 MB
 * lagi tiap kali orang bolak-balik Grafik <-> ROI — lebih mahal daripada keadaan sebelum ini ada.
 * Yang dihemat adalah sesi yang tidak pernah membukanya, dan muat halaman pertama tiap sesi.
 */
function useStickyValue(key, shape, wanted, enabled, onLoading) {
  const [value, setValue] = useState(null);
  // Sekali diminta, tetap diminta — inilah yang menahan langganannya dari lepas-pasang saat orang
  // berpindah tab. Ia hanya kembali false waktu sesinya selesai (`enabled`), yaitu satu-satunya saat
  // melepasnya memang benar.
  const [everWanted, setEverWanted] = useState(false);
  useEffect(() => {
    if (wanted) setEverWanted(true);
  }, [wanted]);

  useEffect(() => {
    if (!enabled) {
      setEverWanted(false);
      setValue(null);
      return undefined;
    }
    if (!everWanted) return undefined;
    onLoading(key, true);
    return subscribeValue(
      key,
      (next) => {
        setValue(next);
        onLoading(key, false);
      },
      (error) => {
        console.warn(`[TigerROI] Sticky value error for ${key}:`, error);
        onLoading(key, false);
      },
    );
  }, [key, everWanted, enabled, onLoading]);

  return shape === "array" ? valueToArray(value) : value;
}

export function useFirebaseStore(navigate, resources, user, enabled = true, route = null) {
  const [store, setStore] = useState(() => emptyStore);
  const [loadingMap, setLoadingMap] = useState({});
  // Dibungkus useCallback supaya ia tidak jadi dependensi yang berubah tiap render — efek langganan
  // yang ikut berjalan ulang tiap render berarti mengunduh ulang node yang justru paling berat.
  const markLoading = useCallback((key, busy) => {
    setLoadingMap((current) => ({ ...current, [key]: busy }));
  }, []);
  const roiSnapshots = useStickyValue(
    "roiSnapshots",
    "array",
    needsRoiSnapshots(route),
    enabled,
    markLoading,
  );
  // Riwayat yang cuma mengisi panel di `/users/{id}` — 2,81 MB yang dulu ikut terunduh bersama
  // `users` pada tiap muat halaman siapa pun. Aturan hidupnya sama persis dengan roiSnapshots di
  // atasnya, termasuk yang penting: sekali dipasang ia TIDAK dilepas saat orang berpindah halaman.
  const userReports = useStickyValue(
    "userReports",
    "object",
    needsUserReports(route),
    enabled,
    markLoading,
  );
  const actor = user?.email || user?.name || user?.uid || "system";
  const role = user?.role;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    // Subscribing to an admin-only collection as a non-admin would only produce a
    // permission-denied toast on every login, so don't ask for it at all.
    const readableKeys = Object.keys(resources).filter((key) => canReadResource(role, key));

    const resourceUnsubscribers = readableKeys.map((key) => {
      setLoadingMap((current) => ({ ...current, [key]: true }));

      return subscribeResource(
        key,
        (items) => {
          setStore((current) => ({ ...current, [key]: normalizeResourceItems(key, items) }));
          setLoadingMap((current) => ({ ...current, [key]: false }));
        },
        (error) => {
          notifyError(error, "Data gagal dimuat. Coba muat ulang halaman.");
          setLoadingMap((current) => ({ ...current, [key]: false }));
        },
      );
    });

    // Secret TOTP halaman /otp. Berdiri sendiri dan bukan di `resources` karena halaman ini punya
    // tabelnya sendiri (kolom Kode dihitung tiap detik, bukan dibaca dari baris) — dan bukan di
    // `pluginSubscriptions` karena bentuknya koleksi berkunci push, bukan satu node nilai.
    //
    // Superadmin saja, seperti langganan gating dan plugin. Bedanya: di sini aturan database
    // benar-benar akan MENOLAK yang lain, jadi melanggankannya ke akun biasa bukan cuma boros —
    // ia menghasilkan toast permission-denied tiap kali orang login.
    const otpUnsubscribers = isSuperAdmin(role)
      ? [
          subscribeResource(
            "otpSecrets",
            (items) => setStore((current) => ({ ...current, otpSecrets: items })),
            (error) => notifyError(error, "Daftar OTP gagal dimuat. Coba muat ulang halaman."),
          ),
        ]
      : [];

    /**
     * Grup Telegram tujuan notifikasi. Dilanggan SETIAP akun yang login, bukan admin saja: halaman
     * Notification Center menampilkan siapa saja yang menerima tiap topik, dan daftar penerima yang
     * menyembunyikan grup akan menjawab "tidak ada" untuk topik yang sebenarnya sedang mengalir ke
     * chat tim. Isinya memang bukan rahasia — chat id sebuah grup tidak membuka apa pun tanpa token
     * botnya, yang tinggal di secret Cloud Functions.
     *
     * Bukan bagian dari `resources` karena halaman ini punya tabelnya sendiri (saklar per topik,
     * bukan kolom), tapi bentuknya koleksi berkunci push — jadi `subscribeResource`, bukan
     * `subscribeValue`.
     */
    setLoadingMap((current) => ({ ...current, notificationGroups: true }));
    const notificationUnsubscribers = [
      subscribeResource(
        "notificationGroups",
        (items) => {
          setStore((current) => ({ ...current, notificationGroups: items }));
          setLoadingMap((current) => ({ ...current, notificationGroups: false }));
        },
        (error) => {
          notifyError(error, "Daftar grup notifikasi gagal dimuat.");
          setLoadingMap((current) => ({ ...current, notificationGroups: false }));
        },
      ),
    ];

    // Satu daftar dengan penghitung biaya di /activity-logs — lihat lib/storeSubscriptions.js.
    const valueSubscriptions = valueSubscriptionsFor(role);

    const dashboardUnsubscribers = Object.entries(valueSubscriptions).map(([key, shape]) => {
      setLoadingMap((current) => ({ ...current, [key]: true }));

      return subscribeValue(
        key,
        (value) => {
          setStore((current) => ({
            ...current,
            [key]: shape === "array" ? valueToArray(value) : value || emptyStore[key],
          }));
          setLoadingMap((current) => ({ ...current, [key]: false }));
        },
        (error) => {
          console.warn(`[TigerROI] Summary subscription error for ${key}:`, error);
          setLoadingMap((current) => ({ ...current, [key]: false }));
        },
      );
    });

    return () => {
      for (const unsubscribe of [
        ...resourceUnsubscribers,
        ...dashboardUnsubscribers,
        ...otpUnsubscribers,
        ...notificationUnsubscribers,
      ]) {
        unsubscribe();
      }
    };
  }, [resources, enabled, role]);

  const create = async (key, values) => {
    try {
      // A team member is three things: a login, a profile row, and a role. The password only
      // ever goes to Firebase Auth — it is stripped before the profile is written.
      if (key === "users") {
        const { password, ...profile } = values;
        const uid = await createTeamAccount(profile.email, password, {
          name: profile.name,
          username: profile.username,
          role: profile.role,
        });
        if (uid) {
          try {
            await updateResource(
              "users",
              uid,
              {
                name: profile.name,
                username: profile.username,
                role: profile.role,
              },
              actor,
            );
          } catch {
            // Profil sudah dibuat oleh trigger handle_new_user
          }
          await writeRole(uid, profile.role);
        }
        notifySuccess(`Akun ${profile.email} siap dipakai login.`);
        navigate(resources[key].path);
        return;
      }

      await createResource(key, values, actor);
      notifySuccess("Data berhasil ditambahkan.");
      navigate(resources[key].path);
    } catch (error) {
      notifyError(error, "Data gagal ditambahkan. Coba lagi.");
    }
  };

  const update = async (key, id, values) => {
    try {
      const { password: _ignored, ...profile } = values;
      await updateResource(key, id, key === "users" ? profile : values, actor);
      // Changing the Role dropdown has to reach /roles or it changes nothing that matters.
      if (key === "users") {
        const uid = (store.users || []).find((entry) => entry.id === id)?.uid;
        if (uid) await writeRole(uid, profile.role);
      }
      notifySuccess("Perubahan berhasil disimpan.");
      navigate(resources[key].path);
    } catch (error) {
      notifyError(error, "Perubahan gagal disimpan. Coba lagi.");
    }
  };

  // Like `update`, but writes only the named fields — no id/updatedAt/updatedBy alongside them.
  // That is what keeps the write inside the single child path an advertiser is granted.
  const updateFields = async (key, id, values) => {
    try {
      await updateResourceFields(key, id, values);
      notifySuccess("Perubahan berhasil disimpan.");
      navigate(resources[key].path);
    } catch (error) {
      notifyError(error, "Perubahan gagal disimpan. Coba lagi.");
    }
  };

  // Tandai satu reminder selesai dari badge topbar — tanpa navigasi (update/updateFields melempar
  // ke halaman resource-nya, dan badge dipanggil dari halaman mana saja). Langganan realtime yang
  // menyusutkan badge dan daftarnya sendiri setelah tulisan mendarat.
  //
  // Baris yang BERULANG tidak diselesaikan melainkan dimajukan ke jatuh tempo berikutnya, dan
  // `completionUpdate` yang memutuskan mana yang mana — satu tempat, dipakai tombol di badge
  // maupun di halaman /reminders.
  const completeReminder = async (id, { recordExpense = false } = {}) => {
    const row = (store.reminders || []).find((entry) => entry.id === id);
    // Diminta di luar `try` supaya `dueDate` yang dipakai sebagai ID adalah yang MASIH berdiri di
    // baris — sesudah `completionUpdate` mendarat, baris berulang sudah memuat jatuh tempo
    // berikutnya, dan pengeluaran akan tercatat untuk periode yang belum dibayar siapa pun.
    const expense = recordExpense ? expenseFromReminder(row || {}) : null;

    try {
      // Pengeluarannya ditulis DULU, baris reminder-nya sesudahnya. Dibalik, tulisan expense yang
      // gagal meninggalkan baris berulang yang sudah dimajukan: klik kedua memajukannya satu
      // periode LAGI dan mencatat pengeluaran untuk jatuh tempo yang salah. Dengan urutan ini,
      // yang tertinggal dari kegagalan di tengah cuma baris expense yang ID-nya turunan — klik
      // kedua menimpanya, bukan menggandakannya.
      if (expense) {
        await createResourceAt("expenses", expense.id, expense.values, actor);
      }

      const update = completionUpdate(row || {});
      await updateResourceFields("reminders", id, update);
      // Kalimatnya menyebut apa yang benar-benar terjadi. "Ditandai selesai" untuk baris yang
      // justru masih berdiri di daftar (dengan tanggal baru) akan terbaca sebagai tombol yang
      // tidak bekerja — dan orang akan menekannya lagi, memajukannya satu periode lagi.
      //
      // Baris expense yang ikut ditulis DISEBUTKAN, tidak dibiarkan diam-diam: yang menulis ke
      // halaman Keuangan tanpa mengabarkan apa pun adalah yang tidak akan pernah dicari orang
      // ketika angkanya ternyata tidak cocok.
      const advanced = update.dueDate
        ? `Pengingat dimajukan ke ${formatDate(update.dueDate)}.`
        : "Pengingat ditandai selesai.";
      notifySuccess(expense ? `${advanced} Dicatat juga di Expenses.` : advanced);
    } catch (error) {
      notifyError(error, "Gagal menandai selesai. Coba lagi.");
    }
  };

  const remove = async (key, id) => {
    try {
      // Archiving a team member also takes their access away; the login itself can only be
      // deleted from the Firebase console.
      if (key === "users") {
        const uid = (store.users || []).find((entry) => entry.id === id)?.uid;
        if (uid) await writeRole(uid, null);
      }
      await deleteResource(key, id, actor);
      notifySuccess("Data berhasil dipindahkan ke arsip.");
    } catch (error) {
      notifyError(error, "Data gagal diarsipkan. Coba lagi.");
    }
  };

  // Tarif ad tax dari halaman Settings. Yang tersimpan persen (itu yang diketik orang); sync dan
  // tabel yang membaginya dengan 100.
  const saveRoiSettings = async (values) => {
    try {
      await updateSettings("roiSettings", values, actor);
      notifySuccess("Pengaturan ROI tersimpan. Sync berikutnya memakai tarif ini.");
    } catch (error) {
      notifyError(error, "Pengaturan ROI gagal disimpan. Coba lagi.");
    }
  };

  /**
   * Saklar satu topik untuk satu orang — dari halaman Notification Center.
   *
   * Dipakai admin (mengatur siapa saja) MAUPUN orangnya sendiri (mengatur dirinya): satu saklar,
   * dua tangan. Yang membedakan keduanya cuma aturan database — `users/$uid/notificationTopics`
   * melepaskan admin dan pemilik barisnya (dicocokkan lewat email), sisanya ditolak.
   *
   * Menjawab berhasil/gagal, tidak menavigasi sendiri: yang memanggilnya adalah form di
   * `/notifications/orang/{id}/edit`, dan halaman yang berpindah setelah tulisan yang DITOLAK
   * database akan terbaca sebagai perubahan yang tersimpan.
   */
  const saveNotificationTopics = async (userId, topics) => {
    try {
      await writeNotificationTopics(userId, topics);
      return true;
    } catch (error) {
      notifyError(error, "Saklar notifikasi gagal disimpan. Coba lagi.");
      return false;
    }
  };

  // Chat id Telegram satu orang, dari halaman Notification Center. Admin untuk siapa saja, dan tiap
  // orang untuk dirinya sendiri — id-nya baru terbit setelah ia menyapa botnya, jadi dialah yang
  // paling mungkin memegangnya.
  //
  // Menjawab berhasil/gagal alih-alih memberi toast sendiri: formnya menulis DUA hal (chat id lalu
  // saklarnya), dan dua toast "tersimpan" untuk satu tombol Simpan terbaca seperti dua penyimpanan
  // yang berbeda. Yang mengabarkan hasilnya satu, di form.
  const saveTelegramChatId = async (userId, chatId) => {
    try {
      await writeTelegramChatId(userId, chatId);
      return true;
    } catch (error) {
      notifyError(error, "Chat ID gagal disimpan. Coba lagi.");
      return false;
    }
  };

  // Setelan satu topik: saklar globalnya dan role yang disiarkan. Admin saja (aturan `settings`).
  // Ditulis per topik, bukan seluruh node: dua admin yang mengubah dua topik berbeda pada saat yang
  // sama tidak boleh saling menimpa.
  const saveNotificationSettings = async (topic, values) => {
    try {
      await updateSettings("notificationSettings", { [topic]: values }, actor);
      notifySuccess("Setelan topik tersimpan.");
    } catch (error) {
      notifyError(error, "Setelan topik gagal disimpan. Coba lagi.");
    }
  };

  // Grup Telegram tujuan notifikasi. Baris biasa (push key, soft delete) — yang membedakannya dari
  // resource lain cuma tidak adanya halaman daftar/form sendiri.
  const saveNotificationGroup = async (id, values) => {
    try {
      if (id) await updateResource("notificationGroups", id, values, actor);
      else await createResource("notificationGroups", values, actor);
      notifySuccess(id ? "Grup diperbarui." : "Grup ditambahkan.");
      return true;
    } catch (error) {
      notifyError(error, "Grup gagal disimpan. Coba lagi.");
      return false;
    }
  };

  const removeNotificationGroup = async (id) => {
    try {
      await deleteResource("notificationGroups", id, actor);
      notifySuccess("Grup dihapus dari daftar tujuan.");
    } catch (error) {
      notifyError(error, "Grup gagal dihapus. Coba lagi.");
    }
  };

  /**
   * Chat yang menyapa bot jadi penerima — tombol Aktifkan di tab "Calon Penerima".
   *
   * Baris `notificationGroups` biasa, lewat jalur yang sama dengan form Tambah Penerima: yang
   * dihapus fitur ini cuma PENGETIKAN chat id-nya, bukan bentuk barisnya. Tidak ada apa pun yang
   * ditulis ke baris inbox-nya — ia hilang dari daftar tawaran sendiri begitu chat id-nya muncul
   * sebagai penerima, karena `pendingChats` menghitungnya alih-alih membaca kolom status.
   */
  const activateDetectedChat = async (chat) => {
    try {
      await createResource("notificationGroups", detectedContactEntry(chat), actor);
      notifySuccess(`${chat?.title || chat?.chatId} sekarang menerima notifikasi.`);
      return true;
    } catch (error) {
      notifyError(error, "Penerima gagal diaktifkan. Coba lagi.");
      return false;
    }
  };

  // Tombol Abaikan. Barisnya TIDAK dihapus — dihapus, ia lahir lagi utuh pada sapaan berikutnya,
  // dan daftar tawaran menawarkan chat yang sama berulang kali selamanya.
  const dismissDetectedChat = async (chat) => {
    try {
      await updateResourceFields("telegramInbox", chat.key, dismissUpdate(actor));
      notifySuccess("Chat diabaikan. Ia tidak akan ditawarkan lagi.");
    } catch (error) {
      notifyError(error, "Chat gagal diabaikan. Coba lagi.");
    }
  };

  /**
   * Ambang peringatan ROI, dari tab Peringatan ROI di halaman Notification Center.
   *
   * Yang membacanya `scheduledSync` lewat `alertSettings()` di functions/alerts-core.js — satu
   * tempat yang menormalkan angkanya, jadi form ini boleh menyimpan apa yang diketik orang tanpa
   * menebak-nebak bentuknya.
   *
   * `enabled` TIDAK ikut dikirim form itu, dan itu disengaja: on/off Peringatan ROI tinggal di
   * saklar topiknya (`saveNotificationSettings`), satu-satunya tempat. Nilai lama yang masih
   * tersimpan di node ini ditimpa `runAlerts` sebelum menilai.
   */
  const saveAlertSettings = async (values) => {
    try {
      await updateSettings("alertSettings", values, actor);
      notifySuccess("Ambang peringatan tersimpan. Sync berikutnya memakainya.");
    } catch (error) {
      notifyError(error, "Ambang peringatan gagal disimpan. Coba lagi.");
    }
  };

  /**
   * Simpan/hapus satu baris target: domain + bulan + jenis akun.
   *
   * Yang ditulis adalah node BULAN utuh (lihat `writeTarget`), disusun `targetMonthUpdate` dari
   * yang sudah tersimpan — jadi mengisi baris Adsense tidak menghapus target Ad-Exchanger di
   * sebelahnya, termasuk yang masih berbentuk lama. Baris yang keempat isiannya dikosongkan
   * DIHAPUS: sebuah baris kosong yang tersimpan tidak berbeda dari yang belum pernah diisi, dan
   * hanya yang pertama yang bertahan sebagai node di RTDB.
   */
  const saveTarget = async (domainId, month, slug, values) => {
    try {
      if (values?.target !== "" && values?.target !== null && values?.target !== undefined) {
        if (!Number.isFinite(Number(values.target))) {
          notifyError(new Error("invalid"), "Target harus berupa angka.");
          return;
        }
      }
      const record = targetMonthUpdate(store.domainTargets, domainId, month, slug, values);
      const kept = Boolean(record?.[slug]);
      await writeTarget(domainId, month, record);
      notifySuccess(kept ? "Target tersimpan." : "Target dihapus.");
    } catch (error) {
      notifyError(error, "Target gagal disimpan. Coba lagi.");
    }
  };

  /**
   * "Impor dari Google": adsense accounts come from the GAM network list, domains and
   * subdomains from the ad units those networks expose. Same button, three sources.
   *
   * Dua jalur, dan yang PERTAMA yang hidup hari ini: server kontrol menjalankan fungsi impor yang
   * sama dengan CLI tanpa lewat `allUsers`, jadi DRS tidak menyentuhnya. Callable-nya tinggal
   * sebagai cadangan kalau DRS dilonggarkan.
   *
   * Tidak ada jalur ketiga. Berbeda dari saklar campaign, tidak ada yang bisa diantrekan di RTDB:
   * yang harus dijalankan adalah pembacaan API Google dengan refresh token yang tidak pernah ada di
   * browser. Server mati + callable mati = CLI, dan halaman mengatakan itu apa adanya.
   */
  const discoverNetworks = async (key = "gamAccounts") => {
    /**
     * Server menjawab 202 begitu impornya berangkat, BUKAN hasilnya.
     *
     * Impor domain memakan ~53 detik, dan Cloudflare di depan server memutus request yang belum
     * menjawab dalam 100 detik. Jadi yang ditunggu di sini bukan jawaban HTTP-nya melainkan baris
     * hasil di `dashboard/discoverRuns/{kind}` — yang tetap terisi walau tab ini ditutup di
     * tengah jalan.
     */
    const runViaControl = async () => {
      let started;
      try {
        started = await runDiscover(key);
      } catch (error) {
        // Yang ditolak server (403 bukan admin, 409 impor lain sedang jalan, 422 belum ada
        // kredensial) tidak akan berbeda hasilnya lewat callable — jalur keduanya cuma untuk server
        // yang tidak terjangkau.
        if (!error.offline || !FUNCTIONS_ENABLED) throw error;
        console.info("[RabbitROI] Server kontrol tak terjangkau, mencoba Cloud Function.", error);
        return null;
      }
      return awaitDiscoverRun(key, started.startedAt);
    };

    try {
      const callable = DISCOVER_CALLABLE[key];
      if (!callable) throw new Error("Data ini belum bisa diimpor dari Google.");
      const res = CONTROL_API_ENABLED ? await runViaControl() : null;
      if (!res) {
        throw new Error(
          CONTROL_API_ENABLED
            ? "Server kontrol tidak menjawab — impor ini hanya bisa lewat server. Coba lagi nanti."
            : "Server kontrol belum dikonfigurasi (VITE_CONTROL_API_URL).",
        );
      }
      const created = res?.created ?? 0;
      const message =
        res?.summary ||
        (created > 0
          ? `${created} data ditambahkan dari Google.`
          : "Tidak ada data baru ditemukan.");
      // The toast names two examples at most; the full lists go to the console, which is where
      // you go to find out WHY nothing was imported — the skipped names are the whole diagnosis.
      const detail = {
        created,
        // Adsense import: what each Google credential could actually see. A credential showing
        // zero networks is the whole answer when a newly connected one imports nothing.
        perCredential: res?.perCredential,
        hostnamesFound: res?.found,
        // Which GAM endpoint knew about the sites — zero across the board means the network has
        // no site list to read, which is a different problem from a parsing one.
        sources: res?.sources,
        skippedNames: res?.skipped || [],
        errors: res?.errors || [],
      };
      // A credential that sees no network at all is a setup problem, not an empty result —
      // the same goes for a run that imported nothing while skipping names it could not read.
      const sawNoNetwork =
        detail.perCredential?.length > 0 && detail.perCredential.every((c) => c.networks === 0);
      if (
        res?.errors?.length ||
        sawNoNetwork ||
        (created === 0 && detail.skippedNames.length > 0)
      ) {
        notifyWarning(message, detail);
        return;
      }
      if (detail.skippedNames.length) console.info("[RabbitROI] Impor dari Google", detail);
      notifySuccess(message);
    } catch (error) {
      notifyError(error, "Data dari Google gagal diambil. Coba lagi.");
    }
  };

  // Per-campaign override of the mapping the Keitaro code already derives. Marked "manual" so the
  // sync leaves it alone from here on — including a deliberate blank, which the code would
  // otherwise refill on the next run.
  const setCampaignSubdomain = async (userId, campaignId, subDomain) => {
    try {
      const user = (store.users || []).find((entry) => entry.id === userId);
      const campaigns = toCampaignArray(user?.campaigns);
      const next = campaigns.map((campaign) =>
        (campaign.id || campaign.campaign) === campaignId
          ? { ...campaign, subDomain, subDomainSource: "manual" }
          : campaign,
      );
      await updateResource("users", userId, { campaigns: next }, actor);
      notifySuccess(
        subDomain ? `Campaign dipetakan ke ${subDomain}.` : "Pemetaan campaign dikosongkan.",
      );
    } catch (error) {
      notifyError(error, "Pemetaan campaign gagal disimpan. Coba lagi.");
    }
  };

  /**
   * Nyalakan/matikan satu campaign di Meta.
   *
   * Tiga jalur, satu bentuk perintah. Server kontrol dulu (hasilnya seketika, dan itu satu-satunya
   * yang bekerja tanpa menunggu di bawah DRS); callable kalau DRS sudah dilonggarkan; kalau keduanya
   * tidak ada, perintah yang sama ditulis langsung ke antrean RTDB dan cron di dalam server kontrol
   * yang mengurasnya — bukan lagi `scheduledCampaignCommands`, yang sudah dihapus. Pola yang sama
   * dengan tombol sync — bedanya di sini jalur cadangannya bukan CLI, karena orang yang mematikan
   * campaign yang sedang membakar anggaran tidak bisa disuruh membuka terminal.
   */
  const setCampaignStatus = async (userId, campaign, active) => {
    const status = active ? "ACTIVE" : "PAUSED";
    const name = campaign?.campaign || "Campaign";
    try {
      const command = campaignCommandEntry(campaign, status, actor);

      // Cermin panel ad set milik campaign ini dibuang, apa pun jalur yang dipakai di bawah:
      // mematikan campaign mengubah `effective_status` SETIAP ad set-nya jadi CAMPAIGN_PAUSED, dan
      // panel yang menjawab dari cermin akan menerangkan Rp 0 dengan sebab yang sudah tidak berlaku
      // ("campaign di atasnya mati") — atau sebaliknya, menyembunyikan sebab yang baru saja lahir.
      adSetCache.invalidate(adSetCacheKey(userId, command.campaignId));

      // Jalur tercepat, dan satu-satunya yang bekerja di bawah DRS tanpa menunggu: server kontrol
      // memegang token Meta dan menjawab hasil sungguhan. Kalau tak terjangkau, perintahnya jatuh ke
      // antrean di bawah — jadi server yang mati memperlambat saklarnya, tidak mematikannya.
      if (CONTROL_API_ENABLED) {
        try {
          await setCampaignStatusNow(userId, command.campaignId, status);
          notifySuccess(active ? `${name} dinyalakan.` : `${name} dimatikan.`);
          return;
        } catch (error) {
          // Yang ditolak server (403 bukan pemilik, 404 bukan campaignnya) tidak akan berubah
          // hasilnya lewat antrean — antreannya tunduk pada aturan database yang sama.
          if (!error.offline) {
            notifyError(error, `Status ${name} ditolak server.`);
            return;
          }
          console.info("[RabbitROI] Server kontrol tak terjangkau, jatuh ke antrean.", error);
        }
      }

      await writeCampaignCommand(userId, command.campaignId, command);
      // Sengaja tidak mengaku sudah selesai: yang baru terjadi adalah perintahnya tercatat, dan
      // Meta belum tahu apa-apa. Tabelnya menampilkan "Menunggu" sampai penerap menjawab.
      notifySuccess(
        active
          ? `${name} diantre untuk dinyalakan di Meta.`
          : `${name} diantre untuk dimatikan di Meta.`,
      );
    } catch (error) {
      notifyError(error, `Status ${name} gagal diubah. Coba lagi.`);
    }
  };

  /**
   * Gate/Ungate satu campaign Keitaro.
   *
   * Tidak ada cabang `FUNCTIONS_ENABLED` di sini seperti saklar campaign di atas, dan itu
   * disengaja. Yang memanggil vi-control harus memegang API key-nya, dan key itu bisa mengubah
   * tujuan trafik iklan yang sedang berjalan: ia tidak boleh sampai ke browser bahkan kalau DRS
   * dilonggarkan besok dan callable bisa dipanggil. Jadi cuma dua jalur — server kontrol (yang
   * memegang key itu di sisinya sendiri), dan antrean RTDB yang dikuras cron di dalam server yang
   * sama. `scheduledGating` sudah tidak ada.
   */
  const setCampaignGate = async (row, action) => {
    const name = row?.name || `Campaign ${row?.campaignId || ""}`;
    let command;
    try {
      command = gateCommandEntry(row, action, actor);
    } catch (error) {
      notifyError(error, `Perintah gating untuk ${name} gagal disiapkan.`);
      return;
    }

    // Jalur cepat: server kontrol (Bun + Elysia) memegang API key-nya dan menjawab hasil sungguhan
    // dalam hitungan detik. Kalau ia tidak terjangkau, perintahnya tetap masuk antrean RTDB di bawah
    // dan cron yang menyelesaikannya — jadi server yang mati memperlambat gating, tidak mematikannya.
    if (CONTROL_API_ENABLED) {
      try {
        const res = await runGate(command.campaignId, action);
        const { tone, message, note } = gateResultMessage(name, action, res);
        const text = note ? `${message} ${note}` : message;
        // `problem` sengaja lewat notifyError dan bukan notifyWarning: keduanya menggambar toast
        // merah, tapi yang pertama juga menulis ke console.error — dan ini satu-satunya hasil di
        // halaman ini yang meninggalkan routing berubah tanpa terbukti benar.
        if (tone === "success") notifySuccess(text);
        else if (tone === "warning") notifyWarning(text, res);
        else notifyError(res, text);
        return;
      } catch (error) {
        // Yang ditolak server (401/403/422) tidak akan berubah hasilnya lewat antrean — antreannya
        // tunduk pada aturan database yang sama. Mengantrekannya hanya menunda penolakan yang sama
        // dua menit, dengan tombol yang menulis "Menunggu" di sela-selanya.
        if (!error.offline) {
          notifyError(error, `Gating ${name} ditolak server.`);
          return;
        }
        console.info("[RabbitROI] Server kontrol tak terjangkau, jatuh ke antrean.", error);
      }
    }

    try {
      await writeGateCommand(command.campaignId, command);
      // Sengaja tidak mengaku sudah selesai: yang baru terjadi adalah perintahnya tercatat, dan
      // Keitaro belum tahu apa-apa. Tabelnya menampilkan "Menunggu" sampai penerap menjawab.
      notifySuccess(
        action === "gate"
          ? `${name} diantre untuk di-gate.`
          : `${name} diantre untuk dikembalikan ke URL langsungnya.`,
      );
    } catch (error) {
      notifyError(error, `Perintah gating untuk ${name} gagal ditulis. Coba lagi.`);
    }
  };

  // Minta cermin gating disegarkan. Lewat server kalau ada (seketika); kalau tidak, yang bisa
  // ditulis browser hanya stempel waktu yang dibaca cron berikutnya.
  const refreshGating = async () => {
    if (CONTROL_API_ENABLED) {
      try {
        const res = await requestRefresh();
        notifySuccess(
          `Disegarkan: ${res?.campaigns ?? 0} campaign, ${res?.previews ?? 0} pratinjau.`,
        );
        return;
      } catch (error) {
        if (!error.offline) {
          notifyError(error, "Penyegaran ditolak server.");
          return;
        }
      }
    }

    try {
      await requestGateRefresh();
      notifySuccess("Penyegaran diminta. Datanya menyusul di sync gating berikutnya.");
    } catch (error) {
      notifyError(error, "Permintaan penyegaran gagal ditulis. Coba lagi.");
    }
  };

  const importItems = async (key, items) => {
    try {
      await createManyResources(key, items, actor);
      notifySuccess(`${items.length} data berhasil diimpor.`);
    } catch (error) {
      notifyError(error, "Data gagal diimpor. Periksa isi filenya lalu coba lagi.");
    }
  };

  /**
   * Tambah satu baris OTP dari halaman /otp.
   *
   * Berdiri sendiri di luar `create` karena yang di sana melempar ke `resources[key].path` setelah
   * selesai — dan halaman ini bukan resource: tidak ada daftar untuk dituju, tabelnya ada di
   * halaman yang sama dan langganan realtime yang memunculkan barisnya.
   */
  const saveOtpSecret = async (values) => {
    try {
      await createResource("otpSecrets", values, actor);
      notifySuccess(`OTP "${values.name}" tersimpan.`);
      return true;
    } catch (error) {
      notifyError(error, "OTP gagal disimpan. Coba lagi.");
      return false;
    }
  };

  // Arsip, bukan hapus — sepola dengan `remove` di atas, dan `snapshotToArray` yang menyaring
  // baris ber-`deletedAt` dari langganan.
  const removeOtpSecret = async (id) => {
    try {
      await deleteResource("otpSecrets", id, actor);
      notifySuccess("OTP dipindahkan ke arsip.");
    } catch (error) {
      notifyError(error, "OTP gagal diarsipkan. Coba lagi.");
    }
  };

  /**
   * Preset negara milik seorang advertiser, disimpan dari dialog Buat campaign.
   *
   * Bentuknya disusun `countryPresetEntry` (murni, dites) — bukan di sini: yang menolak nama kosong
   * dan daftar negara yang tidak sah harus satu tempat, dan aturan database di seberangnya
   * memeriksa bentuk yang sama.
   */
  const saveCountryPreset = async (values) => {
    try {
      const entry = countryPresetEntry(values);
      await createResource("countryPresets", entry, actor);
      notifySuccess(`Preset negara "${entry.name}" tersimpan untuk ${entry.advertiser}.`);
      return true;
    } catch (error) {
      notifyError(error, "Preset negara gagal disimpan. Coba lagi.");
      return false;
    }
  };

  // Arsip, bukan hapus — sepola `removeOtpSecret`, dan pembacanya yang menyaring `deletedAt`.
  const removeCountryPreset = async (id) => {
    try {
      await deleteResource("countryPresets", id, actor);
      notifySuccess("Preset negara dihapus.");
    } catch (error) {
      notifyError(error, "Preset negara gagal dihapus. Coba lagi.");
    }
  };

  /**
   * Template ukuran slot GPT, disimpan dari tab AdX di /plugin.
   *
   * Bentuknya disusun `gptTemplateEntry` (murni, dites), termasuk penolakan nama kembar — yang
   * dioper `existing` adalah daftar yang sedang tergambar di dropdown, bawaan ikut.
   */
  const saveGptTemplate = async (values, existing) => {
    try {
      const entry = gptTemplateEntry(values, existing);
      const saved = await createResource("gptSizeTemplates", entry, actor);
      notifySuccess(`Template ukuran "${entry.name}" tersimpan.`);
      return saved;
    } catch (error) {
      notifyError(error, "Template ukuran gagal disimpan. Coba lagi.");
      return null;
    }
  };

  // Ganti ukuran template tersimpan (namanya tetap). Bawaan ditolak `gptTemplateSizesUpdate`.
  const updateGptTemplate = async (template, sizes) => {
    try {
      await updateResource(
        "gptSizeTemplates",
        template.id,
        gptTemplateSizesUpdate(template, sizes),
        actor,
      );
      notifySuccess(`Template ukuran "${template.name}" diperbarui.`);
      return true;
    } catch (error) {
      notifyError(error, "Template ukuran gagal diperbarui. Coba lagi.");
      return false;
    }
  };

  const removeGptTemplate = async (id) => {
    try {
      await deleteResource("gptSizeTemplates", id, actor);
      notifySuccess("Template ukuran dihapus.");
    } catch (error) {
      notifyError(error, "Template ukuran gagal dihapus. Coba lagi.");
    }
  };

  /**
   * Kode unit AdSense yang BARU SAJA di-inject ke satu subdomain. ID-nya ID subdomain (`set`, bukan
   * push): satu subdomain satu set kode, dan inject ulang menimpanya. Gagal menyimpan cuma di-toast —
   * kodenya sudah tertulis di situs, dan itu yang penting.
   */
  const saveAdsenseSlots = async (subdomainId, name, codes) => {
    try {
      await createResourceAt("adsenseSlots", subdomainId, { name, codes }, actor);
      return true;
    } catch (error) {
      notifyError(
        error,
        `Kode AdSense ${name} sudah ditulis ke situs, tapi gagal disimpan di dashboard.`,
      );
      return false;
    }
  };

  // URL cloaking untuk landing "Buat dari preset". Satu baris per URL, ditulis berurutan — daftarnya
  // puluhan, bukan ribuan.
  const addCloakingUrls = async (urls) => {
    try {
      for (const url of urls) await createResource("cloakingUrls", { url }, actor);
      notifySuccess(`${urls.length} URL cloaking ditambahkan.`);
      return true;
    } catch (error) {
      notifyError(error, "URL cloaking gagal disimpan. Coba lagi.");
      return false;
    }
  };

  const removeCloakingUrl = async (id) => {
    try {
      await deleteResource("cloakingUrls", id, actor);
    } catch (error) {
      notifyError(error, "URL cloaking gagal dihapus. Coba lagi.");
    }
  };

  return {
    // `roiSnapshots` dan `userReports` digabung DI SINI, bukan disimpan ke `store` lewat setState:
    // keduanya langganan yang hidupnya diatur `useStickyValue` sendiri, dan menyalinnya ke state
    // kedua berarti dua salinan megabyte-an yang harus dijaga tetap seragam.
    store: { ...store, roiSnapshots, userReports: userReports || emptyStore.userReports },
    create,
    update,
    updateFields,
    completeReminder,
    remove,
    importItems,
    setCampaignSubdomain,
    setCampaignStatus,
    setCampaignGate,
    refreshGating,
    saveRoiSettings,
    saveAlertSettings,
    saveNotificationTopics,
    saveTelegramChatId,
    saveNotificationSettings,
    saveNotificationGroup,
    removeNotificationGroup,
    activateDetectedChat,
    dismissDetectedChat,
    saveTarget,
    discoverNetworks,
    saveOtpSecret,
    saveCountryPreset,
    removeCountryPreset,
    saveGptTemplate,
    removeGptTemplate,
    updateGptTemplate,
    saveAdsenseSlots,
    addCloakingUrls,
    removeCloakingUrl,
    removeOtpSecret,
    loadingMap,
  };
}

// campaigns[] arrives as an array from the sync, but RTDB hands back sparse arrays as objects.
function toCampaignArray(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : Object.values(value)).filter(Boolean);
}

function valueToArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return Object.entries(value).map(([id, item]) => ({
    id,
    ...item,
  }));
}

function normalizeResourceItems(key, items) {
  if (key !== "users") {
    return items;
  }

  return items.map((item) => ({
    ...item,
    role: normalizeRole(item.role),
  }));
}
