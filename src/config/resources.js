// Ekstensi ditulis lengkap — berbeda dari komponen, yang mengandalkan resolusi Vite. Berkas ini
// ikut dibaca `node --test` (resolveRoute.test.mjs menyandingkan path-nya dengan navigation.js),
// dan Node ESM tidak menebak ekstensi. Sepola dengan seluruh `src/lib`.
import { accountBalanceRows } from "../lib/accountBalance.js";
import { ACCOUNT_STATUSES, ADS_NOT_SERVING } from "../lib/accountStatus.js";
import { bonusPercentRows } from "../lib/bonusPercent.js";
import { subDomainRows } from "../lib/campaignUrl.js";
import { companyPercentRows } from "../lib/companyPercent.js";
import {
  COUNTRY_OPTIONS,
  countryByDomain,
  countryFromHost,
  PAYOUT_TAX_PERCENT,
} from "../lib/countries.js";
import { toDateKey } from "../lib/dateRange.js";
import { ACCOUNT_TYPES, AD_EXCHANGE } from "../lib/earningByAccountType.js";
import { formatMonth } from "../lib/formatDate.js";
import { invalidTrafficRows, invalidTrafficTotal } from "../lib/invalidTraffic.js";
import { PAYOUT_STATUSES, payoutRows } from "../lib/payouts.js";
import { NO_REPEAT, REPEAT_OPTIONS, TYPE_OPTIONS } from "../lib/reminders.js";
import { fullSubDomain, shortSubDomain } from "../lib/subDomainName.js";
import { ASSIGNABLE_ROLES } from "./access.js";

// ponytail: fee = 5% nominal (Rp25.000 dari Rp500.000 pada data awal). Kalau ternyata flat, ganti
// jadi `() => 25000`.
const topupFee = (values) => Math.round(Number(values.nominal || 0) * 0.05);

/**
 * PIC sebuah baris top-up: pemilik akun yang dipilih di kolom Nama / Kode.
 *
 * Dihitung, bukan diketik — nama yang diketik bebas ("nurjaman wl2") tidak akan pernah cocok
 * dengan `pic` di baris ROI, dan satu-satunya tempat kepemilikan akun sudah tercatat adalah
 * `adAccounts.userOwner`. Nilainya tetap DISIMPAN di barisnya: kepemilikan akun whitelist berpindah,
 * dan pemetaan yang dibaca ulang belakangan cuma tahu pemilik hari ini — seluruh setoran bulan lalu
 * akan ikut pindah ke penerima akunnya, menggeser porsi dana dua orang tanpa satu pun baris yang
 * berubah di layar.
 *
 * Akun tanpa pemilik menghasilkan kosong, dan yang memperbaikinya adalah kolom User Pemilik di
 * Ad Accounts — satu tempat untuk seluruh baris akun itu, bukan tiap baris top-up satu per satu.
 */
export const topupPic = (values, store = {}) => {
  const wanted = String(values?.namaKode ?? "")
    .trim()
    .toLowerCase();
  if (!wanted) return "";
  const account = (store.adAccounts || []).find(
    (row) =>
      String(row?.name ?? "")
        .trim()
        .toLowerCase() === wanted,
  );
  return String(account?.userOwner ?? "").trim();
};
/**
 * Kolom Status Sync untuk akun yang saklar Sync Meta-nya dimatikan.
 *
 * Akun ber-`syncDisabled` DILEWATI seluruh modul sync (`continue` di sync-meta.mjs dan tiga berkas
 * lain), jadi `syncStatus`-nya membeku di nilai terakhir sebelum saklarnya digeser — hampir selalu
 * `true`, yang dirender "Synced". Itu label yang berbohong: ia menyebut berhasil untuk akun yang
 * justru tidak dihubungi sama sekali, dan di kolom yang tetangganya benar-benar habis disync.
 *
 * Diturunkan saat DIRENDER, bukan ditulis ke RTDB. Yang ditulis akan basi pada detik saklarnya
 * digeser kembali, dan yang menuliskannya adalah halaman yang sedang dibaca orang — pola yang sama
 * yang dulu menaruh Rp 333.333 di baris setiap orang karena satu percobaan proyeksi.
 *
 * Ini juga yang menggantikan kolom "Sync Meta" tersendiri: satu keadaan tidak perlu dua kolom
 * berdampingan yang selalu bisa dibaca dari satu sama lain. Saklarnya tetap ada di form.
 */
const adAccountRows = (items = []) =>
  items.map((row) => (row?.syncDisabled ? { ...row, syncStatus: "Nonaktif" } : row));

/**
 * Akun GAM yang menaungi sebuah domain, dicari lewat NAMA domainnya (`gamAccounts.name` memang
 * berisi nama domain — lihat kolom "Nama Domain" di halaman GAM).
 *
 * Dipakai `fallback`, bukan `compute`: alamat email dan kode jaringan sebuah link Ad Exchange
 * memang hampir selalu milik akun GAM domain itu, tapi tidak selalu — satu domain bisa dipindah ke
 * akun lain, dan baris lama harus tetap menyebut akun yang benar-benar dipakai waktu itu. `compute`
 * digambar readOnly dan menang atas ketikan orang, jadi ia akan menimpanya tiap kali baris lama
 * disunting.
 *
 * Kembali null untuk role Keuangan, dan itu bukan kegagalan: `gamAccounts` ada di
 * ADMIN_ONLY_RESOURCES (isinya password akun), jadi store-nya memang kosong untuk mereka. Yang
 * terjadi cuma kotaknya tidak terisi sendiri — dan kotak yang bisa diketik tetap bisa diisi.
 */
const gamAccountOfDomain = (values, store = {}) => {
  const wanted = String(values?.domain ?? "")
    .trim()
    .toLowerCase();
  if (!wanted) return null;

  return (
    (store.gamAccounts || []).find(
      (row) =>
        String(row?.name ?? "")
          .trim()
          .toLowerCase() === wanted,
    ) || null
  );
};

/**
 * Bulan yang bentuknya sah, dari kotak <input type="month">.
 *
 * Diperiksa sebelum disambung jadi tanggal, bukan sesudah: `${""}-01` adalah "-01", dan teks itu
 * lolos ke `date` sebagai tanggal yang tidak bisa diurai siapa pun — barisnya lalu hilang dari
 * filter periode dan dari Laba Rugi sekaligus, tanpa satu pun pesan di layar.
 */
const monthValue = (value) => {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : "";
};

// Baris keuangan hampir selalu diinput pada hari kejadiannya, jadi kotak tanggal dibuka sudah
// terisi hari ini. Sebuah fungsi, bukan konstanta modul: dibaca saat form dibuka supaya tab yang
// menginap semalaman tidak menawarkan tanggal kemarin.
const today = () => toDateKey(new Date());

export const resources = {
  users: {
    title: "Team",
    description: "Kelola PIC dan akses user RabbitROI.",
    path: "/users",
    singular: "User",
    uniqueField: "username",
    searchPlaceholder: "Cari nama, email, atau role...",
    detailLabel: "Cek Profile",
    columns: [
      ["name", "Nama PIC"],
      ["email", "Email"],
      ["role", "Role"],
      ["bonusPercent", "% Bonus awal"],
      ["telegramChatId", "Telegram ID"],
    ],
    fields: [
      { name: "name", label: "Nama", required: true },
      { name: "username", label: "Username", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "password",
        label: "Password Login (minimal 6 karakter)",
        type: "password",
        required: true,
        createOnly: true,
      },
      {
        // Multi-role: a user can hold several at once (e.g. user + keuangan). Stored comma-joined.
        name: "role",
        label: "Roles (boleh lebih dari satu)",
        type: "multiselect",
        options: ASSIGNABLE_ROLES,
        default: "user",
        required: true,
      },
      // Tarif bonus TIDAK diketik di sini lagi: ia pindah ke tab Tarif Bonus di Accounting, yang
      // menyimpannya berikut bulan mulai berlakunya. Menyunting `bonusPercent` di sini menghitung
      // ulang bonus seluruh bulan lampau, termasuk yang sudah dibayarkan. Kolomnya tetap di tabel:
      // ia tarif SEBELUM baris bertanggal pertama orang itu (src/lib/bonusPercent.js).
      // Chat ID Telegram TIDAK diketik di sini, dan ketiadaannya adalah perbaikan bug — bukan
      // fitur yang hilang. Kolomnya tetap di tabel; yang mengubahnya adalah halaman Notifikasi
      // (`/notifications/orang/{id}/edit`), yang sudah memeriksa bentuknya sebelum menulis dan
      // menyimpan kotak yang dikosongkan sebagai `null` (`updateTelegramChatId`).
      //
      // Lewat form ini, keduanya tidak terjadi: `values` diisi `item?.[name] || ""`, jadi tiap
      // orang yang belum punya chat id disimpan sebagai STRING KOSONG — dan `.validate` pada
      // `users/$uid/telegramChatId` di database.rules.json menolaknya (`""` tidak cocok dengan
      // /^-?[0-9]{1,20}$/). Yang ditolak bukan field itu saja melainkan SELURUH tulisannya: admin
      // dan superadmin sama-sama tidak bisa menyunting baris Firman, Ibnu (chat id-nya `""`) atau
      // Muhajir ("asli_muhajir"), dan tidak bisa MEMBUAT anggota tim baru sama sekali — yang
      // terbaca di layar cuma "Perubahan gagal disimpan. Coba lagi.", untuk sesuatu yang tidak
      // akan pernah berhasil dicoba lagi.
      //
      // Diperbaiki dengan membuang pintu keduanya, bukan dengan menyalin pemeriksaan dan
      // penormalannya ke sini: dua tempat yang menulis satu field dengan dua aturan akan berselisih
      // suatu hari, dan yang kalah adalah yang lebih longgar. Dijaga `resources.test.mjs`, yang
      // membaca `database.rules.json` dan menolak field form apa pun yang punya `.validate` di
      // bawah `users/$uid`.
    ],
  },
  domains: {
    title: "Domains",
    description: "Kelola domain utama yang sedang dimonitor.",
    path: "/domains",
    singular: "Domain",
    uniqueField: "domainUrl",
    columns: [
      ["domainUrl", "URL Domain"],
      ["networkCode", "Kode Jaringan"],
      // Diisi Sync ROI dari daftar situs GAM/AdSense, tidak diketik siapa pun — karena itu
      // kolomnya ada di sini tapi tidak ada di `fields` (lihat functions/site-approval.js).
      // Ini jawaban Google untuk "kenapa domain ini earning-nya nol"; kolom Status di
      // sebelahnya adalah keputusan kita sendiri, dan keduanya bisa berbeda.
      ["adApproval", "Persetujuan Google"],
      ["adApprovalAt", "Sejak"],
      // Negara rantai pembayarannya, dan ia MEMUTUSKAN sesuatu: domain yang ditandai negara
      // berpajak mengusulkan langkah Pajak Negara di baris Pencairannya (lihat src/lib/countries.js).
      ["country", "Negara"],
      ["status", "Status"],
    ],
    importLabel: "Import File",
    importAccept: ".xlsx,.xls,.csv",
    discoverLabel: "Impor dari Google",
    fields: [
      { name: "domainUrl", label: "Domain URL", required: true },
      { name: "networkCode", label: "Kode Jaringan (AdX)", type: "number", required: true },
      {
        /**
         * Negara rantai pembayaran domain ini — yang menentukan apakah pencairannya kena pajak
         * pemerintah sebelum fee perantara. Pilihan, bukan kotak teks, alasan yang sama dengan
         * Jenis Akun di Invalid Traffic: ia MEMUTUSKAN sesuatu, dan "PK"/"Pakistan"/"pakistan"
         * adalah tiga negara berbeda bagi kolom yang diketik bebas — kolom `negara` di
         * `gamAccounts` sudah membuktikannya, kosong justru untuk domain yang rantai asingnya
         * berjalan.
         *
         * `fallback`, BUKAN `compute`: akhiran domain cuma USULAN, dan usulan yang menang atas
         * ketikan orang akan menimpa negara yang benar tiap kali baris lama disunting.
         * psaonlineappointment.com berakhiran `.com` sementara rantainya Pakistan, jadi tebakan
         * ini memang tidak bisa jadi jawaban akhir.
         */
        name: "country",
        label: "Negara",
        type: "select",
        options: COUNTRY_OPTIONS,
        fallback: (values) => countryFromHost(values.domainUrl),
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Active", "Inactive"],
        required: true,
      },
    ],
  },
  subDomains: {
    title: "Sub Domains",
    description: "Kelola sub domain beserta PIC pemiliknya",
    path: "/sub-domains",
    singular: "Sub Domain",
    // Satu baris per subdomain. Kode campaign-nya boleh banyak (field campaignCodes, dipisah koma) —
    // satu subdomain memang menaungi banyak campaign/adset — jadi jangan bikin baris kembar
    // bernama sama; tambahkan kodenya ke baris yang sudah ada.
    uniqueField: "name",
    searchPlaceholder: "Cari subdomain, domain, atau PIC...",
    importLabel: "Import CSV",
    importAccept: ".csv,.xlsx,.xls",
    discoverLabel: "Impor dari Google",
    // The one field an advertiser may write, so they reach its edit form while the rest of the
    // row stays admin-only (see canEditCampaignCodes and the subDomains rule).
    advertiserFields: ["campaignCodes"],
    // Kolom Campaign URL disaring ke kode baris ini (`campaignUrlForCodes`): satu link per kode
    // yang diketik, bukan seluruh link campaign yang mengarah ke subdomain ini. Diturunkan saat
    // DIRENDER, sepola dengan `adAccountRows` — yang tersimpan di RTDB tetap daftar penuh milik
    // sync (`subDomainCampaignUrls`), dan menuliskan hasil saringan ke sana berarti link sebuah
    // campaign hilang dari database begitu kodenya belum sempat didaftarkan.
    derive: subDomainRows,
    filters: [
      { field: "parentDomain", label: "Semua Domain" },
      { field: "pic", label: "Semua Advertiser" },
    ],
    columns: [
      ["name", "Sub Domain"],
      ["parentDomain", "Domain Induk"],
      ["campaignCodes", "Kode Campaign"],
      // Link yang dipasang di iklan, dari vi-control. TIDAK ada di `fields`: ia ditulis sisi sync
      // (`subDomainCampaignUrls` di functions/gating-core.js) dari daftar campaign Keitaro, dan
      // kotak isian di sini akan jadi salinan kedua yang berbeda dari sumbernya begitu sebuah
      // campaign diganti aliasnya — tanpa satu pun tanda di layar. Yang memindahkannya ke baris
      // subdomain yang benar adalah NAMA campaign-nya ("... TRAFF (complaints.bispdaily.pk)"),
      // dengan Kode Campaign — kolom persis di sebelah kirinya — sebagai cadangan.
      ["campaignUrl", "Campaign URL"],
      ["pic", "PIC / User"],
      ["status", "Status"],
    ],
    fields: [
      {
        // Ditulis PENDEK ("care") karena Domain Induk dipilih di kotak sebelahnya; yang tersimpan
        // tetap hostname penuh, yang dicocokkan sync dengan laporan GAM/AdSense.
        name: "name",
        label: "Subdomain",
        placeholder: "care",
        required: true,
        load: (item) => shortSubDomain(item.name, item.parentDomain),
        save: (values, item) => fullSubDomain(values.name, values.parentDomain, item?.name),
      },
      {
        name: "parentDomain",
        label: "Domain Induk",
        type: "select",
        optionsFrom: "domains",
        optionLabel: "domainUrl",
        optionValue: "domainUrl",
        required: true,
      },
      {
        // The Keitaro link ids that appear at the front of the Meta campaign names pointing here.
        // One subdomain usually owns several — every campaign carrying any of them attributes
        // its spend to this subdomain.
        name: "campaignCodes",
        label: "Kode Campaign (pisahkan dengan koma)",
      },
      {
        name: "pic",
        label: "PIC / User Pemilik",
        type: "select",
        optionsFrom: "users",
        optionLabel: "name",
        optionValue: "name",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Active", "Inactive"],
        required: true,
      },
    ],
  },
  adAccounts: {
    title: "Ad Accounts",
    description: "Kelola akun iklan Meta yang akan dicek statusnya.",
    path: "/ad-accounts",
    singular: "Ad Account",
    uniqueField: "actId",
    searchPlaceholder: "Cari data...",
    syncField: "syncStatus",
    // Kolom "Sync Meta" tersendiri DIBUANG: keadaannya sudah terbaca dari Status Sync, yang
    // menyebut "Nonaktif" untuk akun yang saklarnya dimatikan (lihat `adAccountRows`). Dua kolom
    // berdampingan yang selalu bisa dibaca dari satu sama lain cuma mendorong angka saldo dan
    // spend ke luar layar. Saklarnya tetap ada di form.
    derive: adAccountRows,
    columns: [
      ["name", "Nama Akun Ads"],
      ["actId", "ACT ID Meta"],
      ["userOwner", "User Pemilik"],
      ["syncStatus", "Status Sync"],
      ["balance", "Sisa Saldo"],
      ["spendCap", "Batas Pengeluaran"],
      ["spendToday", "Pengeluaran Hari Ini"],
    ],
    fields: [
      { name: "name", label: "Nama Akun", required: true },
      { name: "actId", label: "Act ID Meta", required: true },
      {
        // Menentukan profil siapa yang menampung campaign akun ini — itulah yang membuat pemetaan
        // campaign -> subdomain (dan karenanya ROI) mungkin. OPSIONAL: dikosongkan berarti akun
        // belum/tidak dimiliki siapa pun — ia tidak muncul di halaman user mana pun dan campaign-nya
        // tak terpetakan sampai owner diisi. Berguna untuk akun yang sedang dilepas dari seseorang.
        name: "userOwner",
        label: "User Pemilik",
        type: "select",
        optionsFrom: "users",
        optionLabel: "name",
        optionValue: "name",
        emptyLabel: "Tanpa pemilik (opsional)",
      },
      {
        // Matikan sync untuk akun yang disuspend Meta: sync berhenti menembak akun ini (dan berhenti
        // gagal terus), campaign lamanya membeku apa adanya. Kosong = ikut sync seperti biasa.
        name: "syncDisabled",
        label: "Sync Meta",
        type: "select",
        options: [
          { value: "", label: "Aktif (ikut sync)" },
          { value: "Nonaktif", label: "Nonaktif (jangan sync)" },
        ],
      },
    ],
  },
  // Network Google Ad Manager. Dulu ini satu-satunya halaman "Adsense" dan namanya sudah salah
  // sejak awal: yang tersimpan di sini adalah networkCode GAM, dan kolom Earning-nya laporan Ad
  // Manager. Sejak akun AdSense berdiri sendiri punya halamannya sendiri, nama yang salah bukan
  // lagi sekadar tidak rapi — ia menunjuk halaman yang keliru waktu sync gagal.
  gamAccounts: {
    title: "GAM",
    description:
      "Kelola network Google Ad Manager, payout, saldo, dan status sync per Kode Jaringan.",
    path: "/gam-accounts",
    singular: "GAM Account",
    uniqueField: "networkCode",
    searchPlaceholder: "Cari data...",
    importLabel: "Import File",
    importAccept: ".xlsx,.xls,.csv",
    discoverLabel: "Impor dari Google",
    syncField: "syncStatus",
    // Kolom "Saldo Kembar": publisher yang barisnya juga berdiri di halaman AdSense. Diturunkan,
    // tidak disimpan — lihat src/lib/accountBalance.js.
    derive: (items, store) => accountBalanceRows(items, store?.adsenseAccounts, "AdSense"),
    columns: [
      ["name", "Nama Domain"],
      ["publisherId", "ID Publisher"],
      ["status", "Status Akun"],
      // Yang dibaca sync terakhir kali, di sebelah yang benar-benar berdiri di kolom Status.
      // Selama keduanya sama, tidak ada yang menyentuhnya; begitu berbeda, kolom Status sedang
      // dipegang orang dan sync berhenti menimpanya — dan kolom inilah satu-satunya tempat "apa
      // kata Google hari ini" tetap terbaca untuk baris seperti itu.
      ["statusAuto", "Status dari Google"],
      ["statusDetail", "Keterangan Status"],
      ["syncStatus", "Status Sync"],
      ["syncEarning", "Earning (Sync)"],
      ["lastSyncReportDate", "Tgl Laporan"],
      ["emailAkun", "Email Akun"],
      ["passwordAkun", "Pass Akun"],
      ["hargaBeli", "Harga Beli"],
      ["totalPayout", "Total Payout"],
      ["kodeCustomer", "Google Auth"],
      ["nomorHp", "Nomor HP"],
      ["emailPemulihan", "Email Pemulihan"],
      ["negara", "Negara"],
      ["registrarDomain", "Registrar Domain"],
      ["expDomain", "EXP Domain"],
      ["emailDomain", "Email Domain"],
      ["passwordDomain", "Pass Domain"],
      ["server", "Server"],
      ["usernameWp", "Username WP"],
      ["passwordWp", "Password WP"],
      ["saldoAdsense", "Saldo Adsense"],
      ["saldoAdExchange", "Saldo Ad-Exchange"],
      ["saldo", "Saldo"],
      ["saldoCurrency", "Mata Uang Saldo"],
      ["saldoShared", "Saldo Kembar"],
      ["saldoDetail", "Keterangan Saldo"],
      ["namaRekening", "Nama Di Rekening"],
      ["noRekening", "No Rekening"],
      ["networkCode", "Kode Jaringan"],
    ],
    fields: [
      { name: "name", label: "Nama Domain", required: true },
      { name: "networkCode", label: "Kode Jaringan", type: "number", required: true },
      { name: "publisherId", label: "Publisher ID (propertyCode)" },
      {
        name: "googleCredential",
        label: "Koneksi Google API (Kosong = Default .env)",
        type: "select",
        optionsFrom: "googleApiConfigs",
        optionLabel: "name",
        optionValue: "name",
        emptyLabel: "Kosong = Default .env",
      },
      {
        // Diisi SYNC — sampai ada orang yang mengubahnya di sini. Sejak itu barisnya DIPEGANG:
        // sync tetap membaca Google tiap run dan menuliskannya ke "Status dari Google" di bawah,
        // tapi kolom ini berdiri apa adanya (`accountStatusPinned` di
        // functions/account-status.js). Yang membutuhkannya adalah akun yang API-nya tidak bisa
        // menjawab (Publisher ID kosong, AdSense Management API belum aktif di project
        // kredensialnya) DAN akun yang keadaan sebenarnya sudah diketahui orang lebih dulu —
        // banding yang sedang berjalan, limit yang baru dicabut Google tapi belum tampak di API.
        //
        // Jalan kembali ke "ikut sync" tidak butuh saklar tersendiri: pilih nilai yang sama dengan
        // "Status dari Google", dan kuncinya lepas sendiri.
        name: "status",
        label: "Status",
        type: "select",
        options: ACCOUNT_STATUSES,
        // Bawaannya DISEBUT, bukan dibiarkan jatuh ke pilihan pertama — yang pertama adalah "Akun
        // Close", dan akun yang baru saja ditambahkan orang tidak boleh lahir sebagai akun yang
        // ditutup Google. "Iklan Belum Tayang" satu-satunya yang benar pada detik itu: belum ada
        // laporan yang membuktikan sebaliknya, dan sync berikutnya menggantinya sendiri.
        default: ADS_NOT_SERVING,
        required: true,
      },
      {
        // Apa yang dijawab Google pada run terakhir. Digambar readOnly lewat `compute` yang
        // mengembalikan nilainya sendiri: ia harus TERBACA saat orang memutuskan status di atasnya
        // — memilih "Ready" tanpa tahu Google sedang menjawab "Limit Iklan" adalah keputusan yang
        // dibuat tanpa satu-satunya keterangan yang menentukan — tapi mengetiknya berarti
        // mengarang jawaban Google, yaitu persis cara kunci di atas bisa dilepas tanpa Google
        // pernah setuju.
        name: "statusAuto",
        label: "Status dari Google (diisi sync)",
        compute: (values) => values.statusAuto || "",
      },
      {
        // Sebab kolom Status di sebelahnya tidak berubah-ubah. Ditulis sync bersama statusnya, dan
        // DIKOSONGKAN begitu akunnya berhasil dicek lagi — jadi yang diketik di sini bertahan hanya
        // selama akun itu memang tidak bisa dijawab API (Publisher ID kosong, AdSense Management
        // API belum aktif di project kredensialnya). Itu keadaan yang sama yang membuat kolom
        // Status sendiri bisa disunting, dan di situlah keterangan yang ditulis orang berguna:
        // "sedang diurus, tiket #123" menjelaskan baris yang kalau tidak cuma berdiri diam
        // berbulan-bulan dengan status yang diketik entah kapan.
        name: "statusDetail",
        label: "Keterangan Status",
        placeholder: "Sebab status ini — ditimpa sync saat akunnya berhasil dicek",
      },
      { name: "emailAkun", label: "Email Akun", type: "email" },
      { name: "passwordAkun", label: "Password Akun", type: "password" },
      // Harga beli akun (modal aset) — dari sheet "Akun Adsense". Diketik orang, bukan sync.
      { name: "hargaBeli", label: "Harga Beli (Rp)", type: "currency" },
      { name: "totalPayout", label: "Total Payout" },
      { name: "kodeCustomer", label: "Google Auth" },
      { name: "nomorHp", label: "Nomor HP" },
      { name: "emailPemulihan", label: "Email Pemulihan" },
      { name: "negara", label: "Negara" },
      { name: "registrarDomain", label: "Registrar Domain" },
      { name: "expDomain", label: "EXP Domain", type: "date" },
      { name: "emailDomain", label: "Email Domain", type: "email" },
      { name: "passwordDomain", label: "Pass Domain", type: "password" },
      { name: "server", label: "Server" },
      { name: "usernameWp", label: "Username WP" },
      { name: "passwordWp", label: "Password WP", type: "password" },
      // Ketiganya DIISI SYNC tiap run (lihat functions/account-balance.js): `saldo` dari
      // `payments/unpaid` — angka Google sendiri — `saldoAdsense` dari earning AFC bulan final
      // terakhir, dan `saldoAdExchange` sisanya. Tetap bisa diketik justru untuk akun yang API-nya
      // tidak bisa menjawab, aturan yang sama dengan kolom Status; yang berhasil dibaca ditimpa
      // run berikutnya.
      { name: "saldoAdsense", label: "Saldo Adsense (Rp)", type: "currency" },
      { name: "saldoAdExchange", label: "Saldo Ad-Exchange (Rp)", type: "currency" },
      { name: "saldo", label: "Saldo (Rp)", type: "currency" },
      { name: "namaRekening", label: "Nama Rekening" },
      { name: "noRekening", label: "No Rekening" },
      // Sepola `syncDisabled` di Ad Accounts: akun yang ditutup Google berhenti ditanya tiap run
      // (dan berhenti gagal terus), kolom earning/status/saldonya membeku di nilai terakhir.
      {
        name: "syncDisabled",
        label: "Sync",
        type: "select",
        options: [
          { value: "", label: "Aktif (ikut sync)" },
          { value: "Nonaktif", label: "Nonaktif (jangan sync)" },
        ],
      },
    ],
  },
  // Akun AdSense berdiri sendiri — yang TIDAK punya network Ad Manager. Ini rumah untuk domain
  // yang pengajuan Ad Manager-nya belum/tidak disetujui Google: earning-nya tetap terbaca lewat
  // AdSense Management API, dan baris ROI-nya tidak membedakan asal laporannya.
  adsenseAccounts: {
    title: "AdSense",
    description:
      "Kelola akun AdSense berdiri sendiri, payout, saldo, dan status sync per Publisher ID.",
    path: "/adsense-accounts",
    singular: "Adsense Account",
    uniqueField: "publisherId",
    searchPlaceholder: "Cari data...",
    importLabel: "Import File",
    importAccept: ".xlsx,.xls,.csv",
    discoverLabel: "Impor dari Google",
    syncField: "syncStatus",
    derive: (items, store) => accountBalanceRows(items, store?.gamAccounts, "GAM"),
    // Kolom mengikuti bentuk record AdSense yang sungguh ada: `name` adalah nama AKUN (bukan
    // domain), dan metriknya datang dari AdSense Management API lewat `earningUpdate` (sync*).
    // Field GAM/manual yang tidak pernah diisi AdSense (email/pass akun, WP, saldo Ad-Exchange,
    // registrar domain) dibuang supaya kolom kosong tidak menyaru sebagai data yang hilang.
    // Yang tersisa selain metrik cuma bookkeeping keuangan yang memang diisi manual.
    columns: [
      ["name", "Nama Akun"],
      ["publisherId", "ID Publisher"],
      ["status", "Status Akun"],
      // Yang dibaca sync terakhir kali, di sebelah yang benar-benar berdiri di kolom Status.
      // Selama keduanya sama, tidak ada yang menyentuhnya; begitu berbeda, kolom Status sedang
      // dipegang orang dan sync berhenti menimpanya — dan kolom inilah satu-satunya tempat "apa
      // kata Google hari ini" tetap terbaca untuk baris seperti itu.
      ["statusAuto", "Status dari Google"],
      ["statusDetail", "Keterangan Status"],
      ["syncStatus", "Status Sync"],
      ["syncEarning", "Earning (Sync)"],
      ["syncImpressions", "Impresi"],
      ["syncClicks", "Klik"],
      ["syncCpc", "CPC"],
      ["syncPageRpm", "Page RPM"],
      ["lastSyncReportDate", "Tgl Laporan"],
      ["googleCredential", "Koneksi Google"],
      ["reportTimeZone", "Zona Laporan"],
      ["currencyCode", "Mata Uang"],
      ["totalPayout", "Total Payout"],
      ["saldoAdsense", "Saldo Adsense"],
      ["saldoAdExchange", "Saldo Ad-Exchange"],
      ["saldo", "Saldo"],
      ["saldoCurrency", "Mata Uang Saldo"],
      ["saldoShared", "Saldo Kembar"],
      ["saldoDetail", "Keterangan Saldo"],
      ["namaRekening", "Nama Di Rekening"],
      ["noRekening", "No Rekening"],
    ],
    fields: [
      { name: "name", label: "Nama Akun", required: true },
      { name: "publisherId", label: "Publisher ID", required: true },
      {
        name: "googleCredential",
        label: "Koneksi Google API (Kosong = Default .env)",
        type: "select",
        optionsFrom: "googleApiConfigs",
        optionLabel: "name",
        optionValue: "name",
        emptyLabel: "Kosong = Default .env",
      },
      {
        // Aturan yang sama persis dengan halaman GAM: diisi sync sampai ada orang yang mengubahnya
        // di sini, dan sejak itu sync cuma menulis "Status dari Google" di bawahnya. Memilih nilai
        // yang sama dengan kolom itu melepas kuncinya.
        name: "status",
        label: "Status",
        type: "select",
        options: ACCOUNT_STATUSES,
        // Bawaannya DISEBUT, bukan dibiarkan jatuh ke pilihan pertama — yang pertama adalah "Akun
        // Close", dan akun yang baru saja ditambahkan orang tidak boleh lahir sebagai akun yang
        // ditutup Google. "Iklan Belum Tayang" satu-satunya yang benar pada detik itu: belum ada
        // laporan yang membuktikan sebaliknya, dan sync berikutnya menggantinya sendiri.
        default: ADS_NOT_SERVING,
        required: true,
      },
      {
        // Pembanding yang menentukan kolom di atasnya sedang dipegang atau tidak — readOnly lewat
        // `compute`, sepola halaman GAM.
        name: "statusAuto",
        label: "Status dari Google (diisi sync)",
        compute: (values) => values.statusAuto || "",
      },
      { name: "totalPayout", label: "Total Payout" },
      // Sama dengan halaman GAM, termasuk Saldo Ad-Exchange — dan itu MENGGANTIKAN alasan lama
      // yang membuangnya dari sini ("field yang tidak pernah diisi AdSense"). Sejak saldo dibaca
      // dari `payments`, ketujuh baris di halaman ini adalah publisher yang SAMA dengan network
      // GAM di sebelah, dan sebagian besar saldonya memang pendapatan Ad Exchange.
      { name: "saldoAdsense", label: "Saldo Adsense (Rp)", type: "currency" },
      { name: "saldoAdExchange", label: "Saldo Ad-Exchange (Rp)", type: "currency" },
      { name: "saldo", label: "Saldo (Rp)", type: "currency" },
      { name: "namaRekening", label: "Nama Rekening" },
      { name: "noRekening", label: "No Rekening" },
      // Sepola `syncDisabled` di Ad Accounts: akun yang ditutup Google berhenti ditanya tiap run
      // (dan berhenti gagal terus), kolom earning/status/saldonya membeku di nilai terakhir.
      {
        name: "syncDisabled",
        label: "Sync",
        type: "select",
        options: [
          { value: "", label: "Aktif (ikut sync)" },
          { value: "Nonaktif", label: "Nonaktif (jangan sync)" },
        ],
      },
    ],
  },
  googleApiConfigs: {
    title: "Google API",
    description: "Kelola credential Google untuk koneksi Adsense.",
    path: "/google-api-configs",
    singular: "Google Credential",
    uniqueField: "clientId",
    authActionField: "status",
    /**
     * Kolom "Izin" ada karena pertanyaan "kredensial mana yang belum bisa membaca AdSense"
     * sebelumnya tidak punya jawaban di layar sama sekali — satu-satunya cara adalah menembak
     * `tokeninfo` per kredensial dari terminal. Kredensial petcins.com berbulan-bulan berstatus
     * "Connected" dengan token yang cuma membawa scope Ad Manager, dan yang terlihat hanyalah
     * halaman AdSense yang kosong.
     *
     * Kosong di kolom ini berarti "belum diketahui" (kredensial itu belum pernah login lewat
     * tombol), BUKAN "tidak punya izin apa-apa" — consent lewat CLI tidak menuliskannya.
     */
    columns: [
      ["name", "Nama Akun/Client"],
      ["clientId", "Client ID"],
      ["scopeSummary", "Izin"],
      ["status", "Status Koneksi"],
    ],
    fields: [
      { name: "name", label: "Nama Kredensial / Pemilik", required: true },
      { name: "clientId", label: "Google Client ID", required: true },
      {
        name: "clientSecret",
        label: "Google Client Secret",
        type: "password",
        required: true,
      },
    ],
  },
  expenses: {
    title: "Expenses",
    description: "Pengeluaran operasional.",
    path: "/expenses",
    singular: "Expense",
    searchPlaceholder: "Cari item atau keterangan...",
    // Terbaru dulu. Daftar ini bertambah tiap hari dan urutan bawaan RTDB adalah urutan
    // dimasukkan, jadi tanpa ini pengeluaran yang baru diinput justru tenggelam di halaman
    // terakhir — tempat paling jauh dari orang yang baru saja mengetiknya.
    defaultSort: { key: "date", direction: "desc" },
    // Kotak Dari/Sampai di samping pencarian, default bulan berjalan, dan total sebulan di sebelah
    // paginasi — pertanyaan yang dibawa orang ke halaman ini selalu "bulan ini habis berapa".
    dateFilterField: "date",
    summaryFields: [{ field: "total", label: "Total" }],
    columns: [
      ["date", "Date"],
      ["itemName", "Nama Item"],
      ["qty", "Qty"],
      ["nominal", "Nominal"],
      ["total", "Total"],
      ["note", "Keterangan"],
    ],
    fields: [
      { name: "date", label: "Date", type: "date", required: true, default: today },
      { name: "itemName", label: "Nama Item", required: true },
      { name: "qty", label: "Qty", type: "number", required: true },
      { name: "nominal", label: "Nominal (Rp)", type: "currency", required: true },
      // Total selalu turunan Nominal x Qty. Sebelumnya diketik manual, jadi dua angka yang
      // seharusnya sinkron bisa berbeda hanya karena salah ketik.
      {
        name: "total",
        label: "Total (Rp) (otomatis)",
        type: "currency",
        compute: (v) => Number(v.nominal || 0) * Number(v.qty || 0),
      },
      { name: "note", label: "Keterangan" },
    ],
  },
  reminders: {
    title: "Reminder",
    description:
      "Pengingat pembayaran yang perlu dibayar atau catatan lain. Dibaca seluruh tim, " +
      "ditambah/diubah admin & keuangan. Yang jatuh tempo dikirim ke Telegram.",
    path: "/reminders",
    singular: "Reminder",
    searchPlaceholder: "Cari judul atau keterangan...",
    // Yang paling mendesak dulu: jatuh tempo terlama/terlewat di atas, bukan urutan input RTDB —
    // reminder yang sudah lewat justru yang paling perlu dilihat.
    defaultSort: { key: "dueDate", direction: "asc" },
    // Sengaja TANPA `dateFilterField`. Filter rentang tanggal default ke bulan berjalan, dan di
    // halaman ini itu menyembunyikan justru yang paling perlu dilihat: tagihan bulan lalu yang
    // terlewat, dan yang jatuh tempo awal bulan depan. Badge topbar menghitung keduanya, jadi
    // halamannya akan tampak kosong untuk pengingat yang sedang berbunyi.
    columns: [
      ["title", "Judul"],
      ["type", "Tipe"],
      ["dueDate", "Jatuh Tempo"],
      // Berdiri di sebelah Jatuh Tempo, bukan di ujung: keduanya menjawab satu pertanyaan yang
      // sama ("kapan"), dan tanggal tanpa keterangan berulang terbaca sebagai tanggal sekali pakai.
      ["repeat", "Ulangi"],
      ["nominal", "Nominal"],
      ["status", "Status"],
      ["note", "Keterangan"],
    ],
    fields: [
      { name: "title", label: "Judul", required: true },
      {
        // Tipe MEMUTUSKAN sesuatu, bukan cuma melabeli: yang bertipe Pembayaran dan bernominal
        // ikut menulis satu baris Expenses saat ditandai selesai (lihat `expenseFromReminder`).
        // Karena itu pilihannya datang dari lib/reminders.js, bukan diketik ulang di sini.
        name: "type",
        label: "Tipe",
        type: "select",
        options: TYPE_OPTIONS,
        default: "Umum",
        required: true,
      },
      { name: "dueDate", label: "Jatuh Tempo", type: "date", required: true, default: today },
      {
        /**
         * Sewa server tiap bulan, perpanjangan domain tiap tahun, setoran tiap minggu — yang
         * diingatkan orang hampir semuanya berulang. Sebelum ini, menandainya selesai berarti
         * pengingatnya hilang dan tidak ada apa pun yang mengingatkan periode berikutnya.
         *
         * Baris yang berulang TIDAK diselesaikan melainkan DIMAJUKAN (lihat `completionUpdate` di
         * src/lib/reminders.js): satu baris per komitmen, bukan satu baris per kejadian. Halaman
         * ini sengaja tidak punya filter tanggal, jadi baris yang menumpuk tidak punya tempat
         * sembunyi — satu pengingat harian akan menulis 365 baris setahun ke daftar yang dibaca
         * seluruh tim.
         */
        name: "repeat",
        label: "Ulangi",
        type: "select",
        options: REPEAT_OPTIONS,
        default: NO_REPEAT,
        required: true,
      },
      {
        // Kelipatannya, supaya "tiap 2 minggu" dan "tiap 3 bulan" tidak butuh satuan sendiri.
        // Kosong = 1, dan itu ditangani `nextDueDate`: kotak yang dikosongkan orang tidak boleh
        // berarti nol langkah, yang adalah pengulangan yang tidak pernah maju.
        name: "repeatEvery",
        label: "Ulangi tiap berapa (kosong = 1)",
        type: "number",
      },
      // Opsional: reminder non-pembayaran tidak punya nominal, dan nol yang dikarang akan tampil
      // seolah tagihannya Rp 0.
      { name: "nominal", label: "Nominal (Rp)", type: "currency" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Belum", "Selesai"],
        default: "Belum",
        required: true,
      },
      { name: "note", label: "Keterangan" },
    ],
  },
  /**
   * Invalid traffic per domain per bulan per JENIS AKUN — potongan Google atas trafik yang
   * dinilainya tidak sah.
   *
   * Satu baris per domain per bulan per jenis akun, bukan per hari: itu bentuk angkanya di laporan
   * yang mengabarkannya, dan Laba Rugi menjumlahkannya per bulan.
   *
   * Yang DIKETIK orang cuma empat: bulan, jenis akun, domain, dan tiga hasil pengecekan. Earning,
   * Ad Spend + Ad Tax, Potongan Company, Net Profit, dan persentase invalid traffic-nya diturunkan
   * dari baris ROI bulan itu saat DIRENDER (`invalidTrafficRows`) — angka yang diketik ulang dari
   * spreadsheet adalah angka yang berbeda dari sumbernya suatu hari, tanpa satu pun tanda di layar.
   */
  invalidTraffic: {
    title: "Invalid Traffic",
    description: "Invalid traffic per domain per bulan per jenis akun.",
    path: "/invalid-traffic",
    singular: "Invalid Traffic",
    searchPlaceholder: "Cari domain, jenis akun, atau keterangan...",
    defaultSort: { key: "no", direction: "desc" },
    // TANPA pemilih rentang tanggal, satu-satunya halaman keuangan yang begitu. Bawaannya bulan
    // berjalan (`currentMonthRange` di ResourceList), dan satu baris di sini adalah satu BULAN
    // yang sudah lewat — dibiarkan, halaman ini terbuka kosong justru bagi orang yang datang
    // menginput hasil pengecekan bulan kemarin. Yang menggantikannya kolom Bulan yang bisa diurut
    // dan kotak pencarian, yang menerima "2026-04" apa adanya.
    derive: invalidTrafficRows,
    filters: [
      // Kuncinya tetap "2026-04" (yang dicocokkan dan ditulis ke `?f_month=`), labelnya "Apr 2026"
      // lewat `formatMonth`. Terbaru dulu: yang dicari hampir selalu bulan yang baru lewat.
      { field: "month", label: "Semua Bulan", formatOption: formatMonth, descending: true },
      { field: "accountType", label: "Semua Jenis Akun" },
      // Yang dicari orang di filter ini cuma satu hal: baris mana yang angkanya masih diketik
      // tangan, supaya bisa dikembalikan ke data sync begitu laporannya datang.
      { field: "dataSource", label: "Semua Sumber" },
    ],
    // Earning dan belanjanya turunan, tapi tetap dijumlahkan di sini: yang dibawa orang ke halaman
    // ini adalah "berapa persen pendapatan bulan ini yang hangus", dan itu tidak bisa dijawab
    // kolom Total yang cuma menjumlah invalid traffic-nya.
    summaryFields: [
      { field: "earning", label: "Earning" },
      { field: "nominal", label: "Total Invalid Traffic" },
    ],
    columns: [
      ["no", "No"],
      ["month", "Bulan"],
      ["accountType", "Jenis Akun"],
      ["domain", "Domain"],
      ["earning", "Earning"],
      ["totalSpending", "Ad Spend + Ad Tax"],
      ["dataSource", "Sumber"],
      ["netProfit", "Net Profit"],
      ["trafficPercent", "Total IVT %"],
      ["nominal", "Total IVT"],
      ["check1", "Check 1"],
      ["check2", "Check 2"],
      ["check3", "Check 3"],
      ["note", "Keterangan"],
    ],
    fields: [
      {
        // Bulannya dipilih, bukan tanggalnya: hari di dalam baris ini tidak dipakai siapa pun, dan
        // kotak tanggal penuh menuntut orang memilih satu hari yang tidak berarti apa-apa lalu
        // membuat dua baris bulan yang sama terlihat seperti dua kejadian berbeda.
        name: "month",
        label: "Bulan",
        type: "month",
        required: true,
        default: () => toDateKey(new Date()).slice(0, 7),
      },
      {
        // Tanggal yang BENAR-BENAR tersimpan, selalu tanggal 1 bulan itu. Turunan dan digambar
        // readOnly, bukan kotak kedua untuk diisi: `buildProfitLoss`, `profitLossMonths`, dan
        // filter periode daftar ini semuanya membaca `date`, dan bulan yang disimpan sebagai
        // "2026-04" telanjang diurai `new Date()` sebagai tengah malam UTC — di zona negatif ia
        // mundur ke Maret.
        name: "date",
        label: "Tanggal tersimpan (otomatis, awal bulan)",
        compute: (values) => (monthValue(values.month) ? `${monthValue(values.month)}-01` : ""),
      },
      {
        // Dua pilihan, bukan kotak teks: nilainya MEMUTUSKAN bagian earning mana yang dijumlahkan
        // (AdX + Ad Server, atau AdSense). Salah ketik satu huruf tidak berbunyi sebagai kesalahan
        // di mana pun — ia menghasilkan baris yang seluruh kolom otomatisnya kosong.
        name: "accountType",
        label: "Jenis Akun",
        type: "select",
        options: ACCOUNT_TYPES,
        default: AD_EXCHANGE,
        required: true,
      },
      {
        // Dipilih dari Domains, bukan diketik: nominalnya dibagi ke advertiser menurut porsi
        // earning tiap orang di domain itu, dan domain yang namanya salah ketik tidak akan cocok
        // dengan satu baris ROI pun — potongannya tetap dikurangkan dari laba, tapi tidak
        // mengurangi bonus siapa-siapa. Sejak kolom otomatis ada, ia juga yang menentukan tarif
        // Potongan Company dan seluruh earning yang dibandingkan dengan nominal ini.
        name: "domain",
        label: "Domain",
        type: "select",
        optionsFrom: "domains",
        optionLabel: "domainUrl",
        optionValue: "domainUrl",
        required: true,
      },
      {
        /**
         * Earning bulan itu kalau laporannya tidak ada — bulan yang lebih tua daripada sync ini,
         * network yang metriknya ditolak, subdomain yang belum terdaftar. Kosong berarti "pakai
         * angka dari baris ROI"; diisi, ia MENANG.
         *
         * Menang dan bukan cuma mengisi yang kosong: sebuah bulan bisa punya baris ROI untuk tiga
         * hari saja, dan angka tiga hari di kolom Earning sebuah bulan penuh salah tanpa kelihatan
         * salah. Kalau ketikan bisa dikalahkan sync yang datang belakangan, ia hilang pada hari
         * sync berhasil sebagian — tanpa satu pun tanda. Yang mengembalikan angka sync adalah
         * mengosongkan kotak ini.
         *
         * TIDAK mengalir ke Laba Rugi: pendapatan di sana dari `weeklyFinancials`, dan angka ini
         * akan jadi pendapatan kedua untuk uang yang sama.
         */
        name: "earningManual",
        label: "Earning — input manual (kosong = pakai data sync)",
        type: "currency",
      },
      {
        // Pasangannya, dan dipisah karena keduanya gagal sendiri-sendiri: laporan GAM yang tidak
        // ada tidak mengatakan apa pun tentang belanja Meta bulan itu, dan sebaliknya. Kolom
        // Sumber menyebut sisi mana yang diketik.
        name: "totalSpendingManual",
        label: "Ad Spend + Ad Tax — input manual (kosong = pakai data sync)",
        type: "currency",
      },
      { name: "check1", label: "Invalid Traffic Check 1 (Rp)", type: "currency" },
      { name: "check2", label: "Invalid Traffic Check 2 (Rp)", type: "currency" },
      { name: "check3", label: "Invalid Traffic Check 3 (Rp)", type: "currency" },
      {
        // Satu-satunya angka di halaman ini yang benar-benar DISIMPAN, karena `buildProfitLoss`
        // membacanya — dan Laba Rugi tidak boleh bergantung pada halaman yang sedang dibuka orang.
        //
        // Baris lama yang diinput sebagai satu nominal tanpa rincian Check tidak kehilangan
        // angkanya saat formnya dibuka: lihat `invalidTrafficTotal`.
        name: "nominal",
        label: "Total Invalid Traffic (otomatis)",
        type: "currency",
        compute: invalidTrafficTotal,
      },
      { name: "note", label: "Keterangan" },
    ],
  },
  /**
   * Laporan Pencairan Rekening — satu baris per domain per BULAN, dari pendapatan yang dilaporkan
   * Google sampai angka yang benar-benar mendarat di rekening.
   *
   * Yang DIKETIK orang cuma bulannya, domainnya, empat angka, dan tujuan transfernya. Earning
   * Google, Potongan Company, Invalid Traffic, Earning Final, Nominal Fee, Sunat Google, Saldo
   * Close, dan Saldo Akhir diturunkan saat DIRENDER (`payoutRows` di src/lib/payouts.js) dari
   * `roiReports`, `companyPercents`, dan `invalidTraffic` — koleksi yang sudah punya halamannya
   * sendiri. Yang diperbaiki di sini diperbaiki di sana.
   */
  accountCloses: {
    title: "Akun Ditutup",
    description: "Earning bulanan subdomain yang akun Google-nya sudah ditutup.",
    path: "/account-closes",
    singular: "Baris Akun Ditutup",
    searchPlaceholder: "Cari subdomain, PIC, atau keterangan...",
    // Terbaru dulu, dan TANPA `dateFilterField` — alasan yang sama persis dengan Invalid Traffic
    // dan Pencairan: satu baris di sini adalah satu BULAN yang sudah lewat, dan filter rentang
    // tanggal yang default ke bulan berjalan membuka halaman ini kosong justru bagi orang yang
    // datang mencatat bulan kemarin.
    defaultSort: { key: "month", direction: "desc" },
    filters: [
      // Kuncinya tetap "2026-05" (yang dicocokkan dan ditulis ke `?f_month=`), labelnya "Mei 2026"
      // lewat `formatMonth` — sepola dengan Invalid Traffic. Terbaru dulu, sama dengan urutan
      // bawaan tabelnya: yang dicari hampir selalu bulan yang baru lewat.
      { field: "month", label: "Semua Bulan", formatOption: formatMonth, descending: true },
      { field: "pic", label: "Semua PIC" },
      { field: "accountType", label: "Semua Jenis Akun" },
    ],
    // TANPA `derive`, dan itu keputusan: seluruh kolom turunannya — Company, Invalid Traffic, Net
    // Profit, Bonus, Net Income Owner — sudah digambar tab Cash Flow, dari baris yang sama.
    // Diturunkan di sini juga, satu subdomain berbunyi dua kali di dua tab bersebelahan, dan yang
    // kedua akan berbeda suatu hari.
    summaryFields: [
      { field: "earning", label: "Earning" },
      { field: "totalSpending", label: "Ad Spend + Ad Tax" },
    ],
    columns: [
      ["month", "Bulan"],
      ["pic", "Advertiser"],
      ["accountType", "Jenis Akun"],
      ["subDomain", "Sub Domain"],
      ["earning", "Earning"],
      ["totalSpending", "Ad Spend + Ad Tax"],
      ["note", "Keterangan"],
    ],
    fields: [
      {
        // Bulannya dipilih, bukan tanggalnya — sepola dengan Invalid Traffic, dan karena alasan
        // yang sama: hari di dalam baris ini tidak dipakai siapa pun.
        name: "month",
        label: "Bulan",
        type: "month",
        required: true,
        default: () => toDateKey(new Date()).slice(0, 7),
      },
      {
        name: "date",
        label: "Tanggal tersimpan (otomatis, awal bulan)",
        compute: (values) => (monthValue(values.month) ? `${monthValue(values.month)}-01` : ""),
      },
      {
        // Dipilih dari Team, bukan diketik: dari sinilah tarif bonus baris ini dicari
        // (`users.bonusPercent`, dicocokkan lewat NAMA seperti `pic` di baris ROI), dan nama yang
        // salah ketik tidak akan cocok dengan siapa pun — barisnya tetap muncul, bonusnya nol, dan
        // tidak ada apa pun di layar yang menyebut sebabnya.
        name: "pic",
        label: "Advertiser (PIC)",
        type: "select",
        optionsFrom: "users",
        optionLabel: "name",
        optionValue: "name",
        required: true,
      },
      {
        // MEMUTUSKAN ember mana yang diisi, dan dengan itu apakah earning-nya kena potongan
        // Company — AdSense tidak. Salah satu huruf tidak berbunyi sebagai kesalahan di mana pun.
        name: "accountType",
        label: "Jenis Akun",
        type: "select",
        options: ACCOUNT_TYPES,
        default: AD_EXCHANGE,
        required: true,
      },
      {
        // Nama subdomain penuh, dan itu yang menghubungkannya ke domain induk (`domainIndex`,
        // pencocokan akhiran yang sama dengan seluruh halaman lain). Diketik dan bukan dipilih
        // dari /sub-domains: subdomain yang akunnya sudah ditutup memang tidak terdaftar di sana,
        // dan itu seluruh alasan halaman ini ada.
        name: "subDomain",
        label: "Sub Domain",
        required: true,
      },
      { name: "earning", label: "Earning (Rp)", type: "currency", required: true },
      { name: "totalSpending", label: "Ad Spend + Ad Tax (Rp)", type: "currency" },
      { name: "note", label: "Keterangan" },
    ],
  },
  payouts: {
    title: "Laporan Pencairan Rekening",
    description: "Pencairan earning Google per domain per bulan, sampai yang masuk rekening.",
    path: "/payouts",
    singular: "Pencairan",
    searchPlaceholder: "Cari domain, bank, nama rekening, atau kode PIP...",
    // Terbaru dulu: yang dicari orang di halaman ini hampir selalu pencairan bulan yang baru saja
    // lewat. Kolom Bulan yang bisa diurut menggantikan pemilih rentang tanggal — lihat di bawah.
    defaultSort: { key: "month", direction: "desc" },
    // TANPA `dateFilterField`, alasan yang sama persis dengan Invalid Traffic: filter rentang
    // tanggal default ke bulan berjalan, dan satu baris di sini adalah satu BULAN yang sudah lewat.
    // Dibiarkan, halaman ini terbuka kosong justru bagi orang yang datang mencatat pencairan bulan
    // kemarin.
    derive: payoutRows,
    filters: [
      // Bulannya dibaca dari baris yang SUDAH lewat `payoutRows`, jadi kuncinya selalu "2026-07"
      // walau yang tersimpan cuma `date` — `monthOf` yang menormalkannya, satu tempat yang sama
      // dengan yang mencocokkan baris ini ke earning dan invalid traffic bulan itu. Labelnya
      // "Jul 2026" lewat `formatMonth`, terbaru dulu.
      { field: "month", label: "Semua Bulan", formatOption: formatMonth, descending: true },
      // Yang dibawa orang ke halaman ini hampir selalu satu pertanyaan: mana yang belum cair.
      { field: "status", label: "Semua Status" },
      { field: "domain", label: "Semua Domain" },
    ],
    // Yang dijumlah adalah kedua UJUNG rantainya: berapa yang dilaporkan Google, dan berapa yang
    // benar-benar tersisa di rekening. Kolom di antaranya cuma berarti baris per baris.
    summaryFields: [
      { field: "earning", label: "Earning Google" },
      { field: "saldoAkhir", label: "Saldo Akhir" },
    ],
    columns: [
      ["month", "Bulan"],
      ["domain", "Domain"],
      ["earning", "Earning Google"],
      ["companyPercent", "Company %"],
      ["company", "Company Ad Exchange"],
      ["invalidTraffic", "Invalid Traffic"],
      ["saldoSebelumnya", "Saldo Sebelumnya"],
      ["earningFinal", "Earning Final"],
      // Berpasangan sepola Fee Rekening / Nominal Fee di sebelahnya, dan berdiri SEBELUM keduanya
      // karena memang begitu urutan pungutannya: pemerintah dulu, perantara dari sisanya.
      ["govTaxPercent", "Pajak Negara"],
      ["govTaxNominal", "Nominal Pajak"],
      ["feePercent", "Fee Rekening"],
      ["feeNominal", "Nominal Fee"],
      ["sunatGoogle", "Sunat Google"],
      ["saldoClose", "Saldo Close"],
      // Judulnya tidak lagi menyebut Gov Tax: pajaknya sudah punya kolomnya sendiri dua langkah
      // di kiri, dan nama yang menjanjikan isi yang sudah pindah adalah cara satu angka terhitung
      // dua kali oleh yang membacanya.
      ["potonganKonversi", "Potongan Konversi"],
      ["saldoAkhir", "Saldo Akhir"],
      ["realMasuk", "Real Masuk Rekening"],
      ["bank", "Bank"],
      ["namaRekening", "Nama Rekening"],
      ["noRekening", "No Rekening"],
      ["kodePip", "Kode PIP"],
      ["status", "Keterangan"],
    ],
    fields: [
      {
        // Bulannya dipilih, bukan tanggalnya, sepola dengan Invalid Traffic: hari di dalam baris
        // ini tidak dipakai siapa pun, dan kotak tanggal penuh membuat dua baris bulan yang sama
        // terlihat seperti dua pencairan yang berbeda.
        name: "month",
        label: "Bulan",
        type: "month",
        required: true,
        default: () => toDateKey(new Date()).slice(0, 7),
      },
      {
        // Tanggal yang benar-benar tersimpan, selalu tanggal 1 bulan itu — alasan yang sama dengan
        // Invalid Traffic: bulan yang disimpan sebagai "2026-04" telanjang diurai `new Date()`
        // sebagai tengah malam UTC, dan di zona negatif ia mundur ke Maret.
        name: "date",
        label: "Tanggal tersimpan (otomatis, awal bulan)",
        compute: (values) => (monthValue(values.month) ? `${monthValue(values.month)}-01` : ""),
      },
      {
        // Dipilih dari Domains, bukan diketik: nama domain inilah yang mencocokkan baris ini dengan
        // earning, tarif Company, dan invalid traffic bulan itu. Salah ketik satu huruf tidak
        // berbunyi sebagai kesalahan di mana pun — ia menghasilkan baris yang seluruh kolom
        // otomatisnya kosong.
        name: "domain",
        label: "Domain",
        type: "select",
        optionsFrom: "domains",
        optionLabel: "domainUrl",
        optionValue: "domainUrl",
        required: true,
      },
      {
        // Sisa saldo bulan sebelumnya yang belum mencapai ambang pembayaran Google, jadi ikut
        // dibayarkan bulan ini. Diketik karena tidak ada satu pun API yang mengabarkannya.
        name: "saldoSebelumnya",
        label: "Saldo Sebelumnya (Rp)",
        type: "currency",
      },
      {
        /**
         * Angka dari notifikasi pembayaran Google — yang juga dikutip di Kode PIP.
         *
         * Kosong berarti "pakai Earning Final"; diisi, ia MENANG, dan selisihnya muncul sendiri di
         * kolom Sunat Google. Sepola dengan `earningManual` di Invalid Traffic, dan karena alasan
         * yang sama: Google membayar menurut angkanya sendiri, dan pada 12 dari 20 baris
         * spreadsheet acuan angkanya TIDAK sama dengan pembukuan kita — sampai Rp 2,6 juta pada
         * satu baris. Sebuah kolom bernama "Real Masuk Rekening" yang diturunkan dari pembukuan
         * sendiri akan berbeda dari mutasi rekening yang jadi buktinya.
         */
        name: "realMasuk",
        label: "Real Masuk Rekening (Rp) — dari notifikasi Google, kosong = pakai Earning Final",
        type: "currency",
      },
      {
        /**
         * Pajak pemerintah negara asal atas pencairan — 10% di Pakistan. Ia memungut SEBELUM fee
         * perantara, jadi ia yang menentukan pembagi fee di bawahnya; sampai kolom ini ada,
         * pajaknya terpaksa ikut Potongan Konversi dan fee-nya dihitung dari angka penuh Google.
         *
         * TARIFNYA TERSIMPAN DI BARIS INI, bukan dibaca dari negara domain saat dirender — itu
         * pelajaran `companyPercents`: tarif yang dibaca dari konstanta menghitung ulang seluruh
         * bulan lampau pada hari angkanya diubah, dan bulan yang sudah dibayarkan bergeser sendiri
         * tanpa satu baris pun disunting. Negara domain cuma mengisi kotaknya saat baris BARU
         * dibuat, lewat `fallback` — jadi ketikan orang selalu menang.
         *
         * Kosong BUKAN 0%, sepola dengan Fee Rekening: nol berarti "negara ini memang tidak
         * memungut", dan itu pernyataan yang berbeda dari tarif yang belum diisi.
         */
        name: "govTaxPercent",
        label: "Pajak Negara (%) — kosong = tidak dipungut",
        type: "number",
        fallback: (values, store) =>
          PAYOUT_TAX_PERCENT[
            countryByDomain(store?.domains).get(
              String(values.domain || "")
                .trim()
                .toLowerCase(),
            )
          ] ?? "",
      },
      {
        // Fee rekening perantara (Pakistan/Meezan pada baris psaonlineappointment.com). Kosong
        // BUKAN 0%: nol berarti "rekening ini memang tidak dipotong", dan itu pernyataan yang
        // berbeda dari tarif yang belum diisi. Dihitung dari sisa SETELAH Pajak Negara di atasnya.
        name: "feePercent",
        label: "Fee Rekening (%) — dari sisa setelah Pajak Negara",
        type: "number",
      },
      {
        // Potongan konversi mata uang asing untuk transfer yang tidak mendarat dalam rupiah.
        // Diketik karena besarannya baru diketahui dari mutasi rekening. Pajak pemerintah SUDAH
        // TIDAK di sini sejak ia punya kolomnya sendiri — dua tempat untuk satu pungutan berarti
        // ia terhitung dua kali oleh yang mengetiknya.
        name: "potonganKonversi",
        label: "Potongan Konversi Mata Uang Asing (Rp)",
        type: "currency",
      },
      { name: "bank", label: "Bank" },
      { name: "namaRekening", label: "Nama Pemilik Rekening" },
      { name: "noRekening", label: "No Rekening" },
      {
        // Kutipan notifikasi pembayaran Google berikut kodenya ("... GG104DV4Y2"). Teks bebas:
        // isinya bukti, dan bukti tidak boleh dirapikan jadi pilihan.
        name: "kodePip",
        label: "Kode PIP / keterangan pembayaran",
      },
      {
        // Pilihan, bukan kotak teks — dan bukan cuma demi kerapian: "Account Close" MEMUTUSKAN
        // Saldo Close, jadi satu huruf meleset menghasilkan baris yang mengaku masih akan cair.
        name: "status",
        label: "Keterangan",
        type: "select",
        options: PAYOUT_STATUSES,
        // Yang baru dicatat adalah yang belum diterima; "Sudah Cair" sebagai bawaan menandai
        // pencairan yang belum tentu terjadi.
        default: "Pending Payment",
        required: true,
      },
    ],
  },
  whitelistTopup: {
    title: "Whitelist Top-Up",
    description: "Top-up saldo akun whitelist berikut fee-nya.",
    path: "/whitelist-topup",
    singular: "Top-Up",
    searchPlaceholder: "Cari nama/kode, PIC, atau keterangan...",
    // Terbaru dulu, alasan yang sama dengan Expenses.
    defaultSort: { key: "date", direction: "desc" },
    dateFilterField: "date",
    // Fee dipisah dari Nominal karena keduanya dibayar ke pihak berbeda; Total adalah jumlah
    // keduanya, jadi ketiganya ditampilkan agar rekonsiliasi tidak perlu hitung tangan.
    summaryFields: [
      { field: "nominal", label: "Nominal" },
      { field: "feeTopup", label: "Fee" },
      { field: "total", label: "Total" },
    ],
    columns: [
      ["date", "Tanggal"],
      ["namaKode", "Nama / Kode"],
      ["pic", "PIC"],
      ["nominal", "Nominal"],
      ["feeTopup", "Fee Topup"],
      ["total", "Total"],
      ["note", "Keterangan"],
    ],
    fields: [
      { name: "date", label: "Tanggal", type: "date", required: true, default: today },
      {
        // PIC dipilih DULU, dan Nama / Kode di bawahnya menyempit ke akun milik PIC itu. Yang
        // dicari orang saat mencatat setoran adalah "untuk siapa", dan daftar seluruh armada untuk
        // memilih satu akun milik satu orang adalah cara akun orang lain tertulis di baris ini.
        //
        // Pilihannya tetap `adAccounts.userOwner`, bukan nama yang diketik bebas: "nurjaman wl2"
        // tidak akan pernah cocok dengan `pic` di baris ROI, dan Proyeksi Budget mencocokkan
        // keduanya. Karena akunnya disaring ke pemilik ini, PIC yang tersimpan tetap sama dengan
        // pemilik akun yang dipilih — invarian yang dulu dijaga `compute`.
        name: "pic",
        label: "PIC",
        type: "select",
        optionsFrom: "adAccounts",
        optionLabel: "userOwner",
        optionValue: "userOwner",
        emptyLabel: "Pilih PIC (kosong = semua akun)",
        // PIC yang diganti MELEPAS akun yang bukan miliknya: dibiarkan, form menyimpan akun orang
        // lain di bawah PIC yang baru dipilih, tanpa satu pun tanda di layar.
        afterChange: (values, store) =>
          values.namaKode && values.pic && topupPic(values, store) !== values.pic
            ? { ...values, namaKode: "" }
            : values,
      },
      {
        // Dipilih dari Ad Accounts, bukan diketik: nama yang sama harus tertulis sama persis di
        // tiap baris — Laba Rugi mengelompokkan fee top-up per `namaKode`, jadi "TBZ 1235" dan
        // "TBZ1235" akan tampil sebagai dua akun yang berbeda.
        name: "namaKode",
        label: "Nama / Kode",
        type: "select",
        optionsFrom: "adAccounts",
        optionLabel: "name",
        optionValue: "name",
        // Disaring ke akun milik PIC terpilih. PIC kosong menawarkan seluruh akun — termasuk yang
        // belum punya User Pemilik, yang tidak akan pernah muncul di bawah PIC mana pun.
        optionsWhere: (account, values) =>
          !values.pic || String(account?.userOwner ?? "").trim() === values.pic,
        // Akun yang dipilih tanpa PIC mengisi PIC-nya dari pemilik akun itu.
        afterChange: (values, store) =>
          values.pic ? values : { ...values, pic: topupPic(values, store) },
        required: true,
      },
      { name: "nominal", label: "Nominal (Rp)", type: "currency", required: true },
      { name: "feeTopup", label: "Fee Topup (otomatis)", type: "currency", compute: topupFee },
      {
        name: "total",
        label: "Total (otomatis)",
        type: "currency",
        compute: (v) => Number(v.nominal || 0) + topupFee(v),
      },
      { name: "note", label: "Keterangan" },
      // Rekening Sumber & Rekening Tujuan dibuang dari tabel DAN form: tidak ada satu pun halaman
      // yang membacanya, dan dua kolom kosong di tiap baris cuma mendorong Nominal dan Total ke
      // luar layar. Nilai yang terlanjur tersimpan dibiarkan berdiri apa adanya di RTDB — yang
      // dihapus tidak bisa dibaca kembali, dan kolomnya masih mungkin kembali.
    ],
  },
  /**
   * Biaya menyambungkan sebuah domain ke Ad Exchange lewat sebuah company — satu baris per
   * penyambungan, bukan per domain.
   *
   * Satu domain disambungkan BERKALI-KALI: designingaround.com lewat Viqeo Inc (Mei), AdsVenture
   * (Mei), Holuron LLC (Juli), lalu objctv.one (Agustus). Yang membedakan barisnya bukan domainnya
   * melainkan tanggal + company-nya, jadi ini catatan kejadian — sepola dengan Expenses. Tarif
   * Company-nya sendiri sekarang punya koleksi sejenis (`companyPercents`, satu baris per tanggal
   * berlaku); yang dulu berdiri sebagai lawan di kalimat ini, kolom `domains.companyPercent` yang
   * ditimpa tiap kali berubah, sudah tidak ada lagi.
   *
   * MASUK rantai Laba Rugi lewat baris Pengeluaran operasional, bersama `expenses` — dan LETAKNYA
   * di rantai itu yang menentukan artinya: dikurangkan SESUDAH dasar bonus advertiser dihitung,
   * jadi biaya membuka jaringan sebuah domain tidak memotong bonus orang yang mengiklankan
   * subdomainnya. Perlakuan yang sama dengan sewa server, dan sengaja berbeda dari invalid traffic.
   *
   * Konsekuensi yang harus diingat saat menginput: biaya yang SUDAH ditulis sebagai baris
   * `expenses` tidak boleh ditulis lagi di sini, karena keduanya kini dijumlahkan ke baris yang
   * sama.
   *
   * Sengaja TANPA `dateFilterField`, sepola dengan Reminder. Filter rentang tanggal default ke
   * bulan berjalan, dan di sini itu menyembunyikan justru yang dicari orang: sambungan yang dibayar
   * bulan April masih sambungan yang hidup hari ini. Daftarnya juga tidak tumbuh tiap hari —
   * dua puluh baris dalam lima bulan — jadi tidak ada yang perlu dipotong per bulan.
   */
  adxCosts: {
    title: "Cost Ad Exchange",
    description: "Biaya penyambungan domain ke Ad Exchange, per company.",
    path: "/adx-costs",
    singular: "Cost Ad Exchange",
    searchPlaceholder: "Cari domain, company, email, atau catatan...",
    // Terbaru dulu, alasan yang sama dengan Expenses: RTDB mengembalikan baris menurut urutan
    // dimasukkan, jadi yang baru saja diinput justru paling jauh dari mata.
    defaultSort: { key: "date", direction: "desc" },
    // Hanya yang rupiah. Ringkasan ResourceList selalu diformat sebagai Rp (`formatRupiah`), jadi
    // menjumlahkan kolom dolar di sana akan berbunyi "Rp 685" untuk US$ 685.
    summaryFields: [{ field: "nominal", label: "Total Biaya" }],
    filters: [
      { field: "domain", label: "Semua Domain" },
      { field: "companyName", label: "Semua Company" },
    ],
    columns: [
      ["date", "Tanggal"],
      ["domain", "Domain"],
      ["companyName", "Company"],
      ["ratio", "Rasio"],
      ["costUsd", "Biaya (US$)"],
      ["nominal", "Biaya (Rp)"],
      ["approvalStatus", "Approval"],
      ["setupAdx", "Setup ADX"],
      ["setupSub", "Setup Sub"],
      ["networkCode", "Kode Jaringan"],
      ["email", "Alamat Email"],
      ["note", "Catatan"],
    ],
    fields: [
      // Kolom BULAN di spreadsheet asalnya tidak ikut: ia turunan penuh dari tanggal, dan
      // `formatDate` sudah menuliskan namanya ("21 Apr 2026"). Dua kolom yang selalu bisa dibaca
      // dari satu sama lain cuma mendorong angka biaya ke luar layar — alasan yang sama yang
      // membuang kolom "Sync Meta" di Ad Accounts.
      { name: "date", label: "Tanggal", type: "date", required: true, default: today },
      {
        // Dipilih dari Domains, bukan diketik: filter "Semua Domain" di atas tabel mengelompokkan
        // baris lewat nilai ini, dan "designingaround.com" yang salah ketik sekali akan berdiri
        // sebagai domain kedua yang biayanya tidak pernah ikut terjumlah dengan saudaranya.
        name: "domain",
        label: "Domain",
        type: "select",
        optionsFrom: "domains",
        optionLabel: "domainUrl",
        optionValue: "domainUrl",
        required: true,
      },
      {
        // Diketik, TIDAK dipilih dari daftar: company-nya berganti tiap beberapa bulan dan
        // sebagian cuma dipakai sekali (AdsVenture, SAN1GO, New Dream Global Corp). Sebuah koleksi
        // sendiri untuk nama yang tidak dibaca halaman lain mana pun cuma menambah satu form yang
        // harus diisi lebih dulu sebelum biaya bisa dicatat.
        name: "companyName",
        label: "Company Name",
        required: true,
      },
      {
        // Bagi hasil antara network turunan (kita) dan induk (company-nya), apa adanya seperti di
        // spreadsheet: "90/10", "92/8". Teks, bukan dua kotak angka — yang dibaca orang adalah
        // pasangannya, dan pasangan yang dipecah dua kolom tidak pernah dibaca sebagai satu nilai.
        name: "ratio",
        label: "Rasio (Turunan/Induk)",
        placeholder: "90/10",
      },
      {
        // OPSIONAL, dan kosongnya berarti sesuatu: baris "Garansi Delink" adalah penyambungan ulang
        // yang tidak ditagih karena link sebelumnya putus. Nol yang dikarang akan tampil sebagai
        // biaya yang benar-benar nol, dan ringkasan di bawah tabel tetap benar tanpanya.
        name: "costUsd",
        label: "Biaya (US$)",
        type: "number",
      },
      {
        // Rupiah yang BENAR-BENAR dibayar hari itu, bukan hasil kali kurs: US$ 70 tercatat
        // Rp 1.238.073 di April dan Rp 1.250.000 di Juni. Yang dikonversi ulang belakangan akan
        // meleset dari mutasi rekening yang jadi bukti pembayarannya.
        name: "nominal",
        label: "Biaya (Rp)",
        type: "currency",
      },
      {
        // Bawaannya "Approve" karena barisnya lahir SESUDAH sambungannya jadi — ini catatan biaya
        // yang sudah dibayar, bukan antrean pengajuan. Yang belum disetujui tetap bisa dicatat,
        // dan itu gunanya dua pilihan lainnya.
        name: "approvalStatus",
        label: "Status Approval",
        type: "select",
        options: ["Approve", "Pending", "Ditolak"],
        required: true,
      },
      // Dua langkah pemasangan yang berdiri sendiri: kode Ad Exchange di sisi network, dan
      // subdomainnya di sisi situs. Keduanya berlencana seperti Approval di sebelahnya — satu
      // kolom status berlencana di antara dua yang tidak akan terbaca seolah dua sisanya cuma
      // catatan (alasan yang sama yang menjadikan `adApproval` lencana di /domains).
      { name: "setupAdx", label: "Setup ADX", type: "select", options: ["Belum", "Done"] },
      { name: "setupSub", label: "Setup Sub", type: "select", options: ["Belum", "Done"] },
      {
        // Terisi sendiri dari `domains.networkCode` saat domainnya dipilih — bukan `compute`,
        // karena baris lama harus tetap menyebut kode yang dipakai waktu itu walau domainnya sudah
        // pindah network. Lihat catatan di `gamAccountOfDomain`.
        name: "networkCode",
        label: "Kode Jaringan",
        type: "number",
        fallback: (values, store = {}) =>
          String(
            (store.domains || []).find(
              (row) =>
                String(row?.domainUrl ?? "")
                  .trim()
                  .toLowerCase() ===
                String(values?.domain ?? "")
                  .trim()
                  .toLowerCase(),
            )?.networkCode ?? "",
          ),
      },
      {
        // Alamat email akun GAM yang memegang network itu. Terisi sendiri HANYA untuk yang boleh
        // membaca `gamAccounts` (admin) — untuk Keuangan kotaknya tetap kosong dan diketik, lihat
        // `gamAccountOfDomain`.
        name: "email",
        label: "Alamat Email",
        type: "email",
        fallback: (values, store) => String(gamAccountOfDomain(values, store)?.emailAkun ?? ""),
      },
      { name: "note", label: "Catatan" },
    ],
  },
  /**
   * Tarif Potongan Company Ad Exchange, BERTANGGAL: satu baris per (domain, tanggal mulai berlaku).
   *
   * Ia dulu satu kolom di `domains` — satu nilai per domain, ditimpa tiap kali berubah — dan yang
   * dibayar karenanya bukan kerapian melainkan RIWAYAT: tarif yang naik dari 10% ke 20% bulan ini
   * menghitung ulang SELURUH bulan lampau dengan tarif hari ini, dan laba Juni yang sudah
   * dilaporkan berubah sendiri tanpa satu pun baris yang disunting. Alasan yang sama persis yang
   * menjadikan `invalidTraffic` dan `adxCosts` koleksi sendiri.
   *
   * Halaman sendiri dan bukan kolom di /domains juga karena JUMLAH BARISNYA bertambah: satu domain
   * punya sebanyak tarif yang pernah berlaku padanya, dan kolom di baris domain hanya bisa memuat
   * satu.
   */
  bonusPercents: {
    title: "Tarif Bonus",
    description: "Tarif bonus advertiser per orang, berikut bulan mulai berlakunya.",
    path: "/bonus-percents",
    singular: "Tarif Bonus",
    searchPlaceholder: "Cari advertiser...",
    defaultSort: { key: "effectiveFrom", direction: "desc" },
    // Kolom "Berlaku s/d" dan "Status" diturunkan persis seperti Potongan Company.
    derive: bonusPercentRows,
    filters: [
      { field: "user", label: "Semua Advertiser" },
      { field: "status", label: "Semua Status" },
    ],
    columns: [
      ["user", "Advertiser"],
      ["percent", "Tarif (%)"],
      ["effectiveFrom", "Berlaku sejak"],
      ["effectiveTo", "Berlaku s/d"],
      ["status", "Status"],
      ["note", "Keterangan"],
    ],
    fields: [
      {
        // Dipilih dari Team: tarifnya dicocokkan ke baris ROI lewat NAMA, sama dengan `pic`.
        name: "user",
        label: "Advertiser",
        type: "select",
        optionsFrom: "users",
        optionLabel: "name",
        optionValue: "name",
        required: true,
      },
      {
        // Kosong = sejak bulan ini TIDAK dapat bonus — bukan "tarif sebelumnya masih berlaku".
        name: "percent",
        label: "Bonus Advertiser (%)",
        type: "number",
      },
      {
        // BULAN, bukan tanggal: dasar bonus adalah net profit sebulan, jadi tarif yang berganti di
        // tengah bulan tidak punya arti yang bisa dihitung.
        name: "month",
        label: "Berlaku sejak (bulan)",
        type: "month",
        required: true,
        default: () => toDateKey(new Date()).slice(0, 7),
      },
      {
        name: "effectiveFrom",
        label: "Tanggal tersimpan (otomatis, awal bulan)",
        compute: (values) => (monthValue(values.month) ? `${monthValue(values.month)}-01` : ""),
      },
      { name: "note", label: "Keterangan" },
    ],
  },
  companyPercents: {
    title: "Potongan Company",
    description: "Tarif Potongan Company Ad Exchange per domain, berikut tanggal berlakunya.",
    path: "/company-percents",
    singular: "Tarif Company",
    searchPlaceholder: "Cari domain atau company...",
    // Terbaru dulu, alasan yang sama dengan Expenses: yang baru diinput adalah yang sedang dicari.
    defaultSort: { key: "effectiveFrom", direction: "desc" },
    derive: companyPercentRows,
    filters: [
      { field: "domain", label: "Semua Domain" },
      { field: "status", label: "Semua Status" },
    ],
    // TANPA pemilih rentang tanggal, sepola dengan Invalid Traffic: bawaannya bulan berjalan, dan
    // `effectiveFrom` sebuah tarif hampir selalu bulan yang sudah lewat — halaman ini akan terbuka
    // kosong justru bagi orang yang datang memeriksa tarif yang sedang berlaku.
    columns: [
      ["domain", "Domain"],
      ["percent", "Tarif (%)"],
      ["companyName", "Company"],
      ["effectiveFrom", "Berlaku sejak"],
      ["effectiveTo", "Berlaku s/d"],
      ["status", "Status"],
      ["note", "Keterangan"],
    ],
    fields: [
      {
        // Dipilih dari Domains, bukan diketik: tarif ini dicocokkan ke baris ROI lewat nama domain
        // induk subdomainnya, dan domain yang namanya salah ketik tidak akan cocok dengan satu
        // baris pun — earning-nya lalu dilaporkan "belum punya tarif" selamanya, tanpa ada yang
        // bisa menebak kenapa.
        name: "domain",
        label: "Domain",
        type: "select",
        optionsFrom: "domains",
        optionLabel: "domainUrl",
        optionValue: "domainUrl",
        required: true,
      },
      {
        // Kosong berarti BELUM DIISI, bukan 0%: Laba Rugi memotong hanya earning yang tarifnya
        // diketahui, dan menyebutkan sisanya sebagai earning yang belum punya tarif. Baris
        // bertarif kosong tetap berguna — ia menandai "sejak tanggal ini tarifnya tidak diketahui",
        // yang berbeda dari "tarif sebelumnya masih berlaku".
        name: "percent",
        label: "Potongan Company Ad Exchange (%)",
        type: "number",
      },
      {
        // TANGGAL, bukan bulan. Sebuah domain di-relink ke company lain di tengah bulan (lihat Cost
        // Ad Exchange: 21 Mei, 11 Juni), dan tarif barunya berlaku sejak hari itu. Laba Rugi
        // menghitung potongannya per baris ROI HARIAN, jadi tanggalnya benar-benar terpakai.
        //
        // Hari SEBELUM baris paling awal sebuah domain tidak jatuh ke tarif paling awal itu: tarif
        // baru yang diisi hari ini tidak boleh menyentuh laba bulan lampau — itu persis keadaan
        // yang halaman ini ada untuk mencegahnya.
        name: "effectiveFrom",
        label: "Berlaku sejak (tanggal)",
        type: "date",
        required: true,
        default: today,
      },
      {
        // Company yang menyambungkan domain ini — Marktube Group, Holuron LLC, Monumetric. Bukan
        // pilihan dari Cost Ad Exchange melainkan teks: yang menentukan tarif adalah kesepakatan,
        // dan sebuah tarif bisa berubah tanpa penyambungan baru. Ia keterangan, tidak dibaca satu
        // perhitungan pun.
        name: "companyName",
        label: "Company (opsional)",
      },
      { name: "note", label: "Keterangan" },
    ],
  },
};
