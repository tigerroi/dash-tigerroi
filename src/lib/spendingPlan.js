import { MIN_ROI_SPEND, withAdTax } from "./adTax.js";
import { cellText } from "./cellText.js";
import {
  filterByDateWindow,
  isRunningRow,
  parseDateLike,
  runningDayKey,
  toDateKey,
} from "./dateRange.js";
import { ensure, round, sumBy } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Proyeksi belanja berikutnya per advertiser — halaman `/spending`.
 *
 * Pertanyaannya bukan "siapa yang ROI-nya paling tinggi" (tabel ROI sudah menjawab itu tiap hari)
 * melainkan "dana berikutnya dibagi berapa ke masing-masing". Satu angka yang diketik orang — dana
 * per hari untuk seluruh tim — dan tabel ini membaginya sebanding dengan ROI tiap advertiser.
 *
 * ## Dua ROI, satu rumus, dua pembagi
 *
 * Bentuknya sama dengan spreadsheet acuan halaman ini: `earning ÷ pembagi × 100` (Rp 18 juta
 * atas belanja Rp 2 juta = 900%). Seluruh dashboard lain memakai `(earning − belanja) ÷ belanja`
 * lewat `roiPercent`, yang untuk angka yang sama menjawab 800%. Selisihnya tepat 100 poin, dan
 * bentuk "berapa kali modal itu kembali" dipilih di sini karena ia yang dipakai memutuskan: ia
 * tidak pernah kurang dari nol, sementara selisih laba bisa negatif — dan bobot minus dalam
 * pembagian proporsional membalik tanda porsi setiap orang lain di daftar.
 *
 * Pembaginya yang berbeda:
 * - **ROI Advertiser** — belanja (spend + ad tax). Yang diukur: seberapa hemat orang itu beriklan.
 * - **ROI Owner** — total top-up whitelist orang itu di periode yang sama. Yang diukur: seberapa
 *   kali uang yang disetor pemilik kembali sebagai pendapatan. Pembagi yang sama dengan kolom
 *   Total Topup di sebelahnya, bukan dibalik (topup ÷ earning): angka yang terbalik berdiri di
 *   kolom yang sama dengan 900% dan terbaca sebagai orang yang rugi, padahal modalnya kembali
 *   sembilan kali.
 *
 * Dana berikutnya dibagi sebanding dengan **ROI Owner**, bukan ROI Advertiser. Yang dibagi di
 * halaman ini adalah uang pemilik — setoran berikutnya — jadi yang menentukan porsi adalah berapa
 * kali setoran orang itu kembali sebagai pendapatan, bukan seberapa hemat ia membelanjakan yang
 * sudah diterimanya. Dua konsekuensinya diketahui dan diterima: top-up bisa tertinggal dari belanja
 * (disetor sekali, dibelanjakan beberapa hari), jadi porsi ikut bergerak mengikuti jadwal setor;
 * dan yang belum menerima setoran sama sekali di periode itu tidak berbobot — bukan berbobot nol —
 * sehingga dananya jatuh utuh ke baris yang tersisa, dengan sebabnya tertulis di bawah namanya.
 *
 * Total top-up diambil dari `whitelistTopup` (nominal, tanpa fee). Yang menentukan pemiliknya
 * adalah kolom **PIC** yang TERSIMPAN di baris top-up itu sendiri — diisi otomatis dari
 * `adAccounts.userOwner` saat barisnya ditulis, bukan diketik; hanya baris yang PIC-nya kosong yang jatuh ke
 * pemetaan `namaKode` -> `adAccounts.userOwner` (mis. "TBZ 1247" -> pemiliknya hari ini). Urutan
 * itu disengaja: akun whitelist berpindah pemilik, dan pemetaan akun cuma tahu keadaan sekarang —
 * setoran bulan lalu ikut berpindah ke penerima akunnya, tanpa satu pun baris yang berubah di
 * layar. Kolom **Keterangan** TIDAK lagi ikut dibaca sama sekali (dulu ia tebakan terakhir): ia
 * teks bebas berisi catatan orang, dan satu keterangan yang kebetulan menyebut sebuah nama
 * memindahkan setoran orang lain ke baris itu.
 *
 * ## Tidak ada satu pun angka yang ditulis ke RTDB
 *
 * Halaman ini kalkulator proyeksi: dana yang diketik tinggal di alamat halaman, dan yang boleh
 * tinggal di database cuma yang datang dari API — baris ROI yang ditulis sync. Versi pertama
 * menyimpan budget/hari tiap orang di `users.budgetPerDay`, dan akibatnya terlihat seketika: satu
 * percobaan proyeksi menulis Rp 333.333 ke baris SETIAP orang di tim, lalu angka itu berdiri di
 * profil mereka sebagai fakta. `functions/migrations/drop-user-budget-per-day.mjs` yang
 * membersihkannya.
 *
 * ## Porsi menjawab "berapa bagiannya", Perlu Transfer menjawab "berapa yang dikirim"
 *
 * Dua pertanyaan berbeda, dan sebelum kolom Sisa Saldo ada cuma yang pertama yang terjawab.
 * Advertiser yang di akunnya masih ada Rp 3 juta tidak perlu menerima porsinya utuh: uang itu
 * menumpuk sebagai modal menganggur, dan modal menganggur MENEKAN ROI Owner-nya di periode
 * berikutnya — ia mendapat porsi lebih kecil karena uang yang tidak pernah ia minta.
 *
 * `Perlu Transfer = max(0, Next Budget − Sisa Saldo)`. Yang TIDAK berubah: Next Budget tetap
 * berjumlah persis sebesar dana yang diketik, dan porsi tetap murni turunan ROI Owner. Saldo tidak
 * ikut jadi pembagi ROI Owner sama sekali — dikurangkan dari sana, pembaginya berubah jadi "modal
 * yang benar-benar terpakai", yang hampir sama dengan belanja, dan kedua kolom ROI saling mendekat
 * sampai tidak ada bedanya lagi. Uang yang disetor tapi menganggur memang menekan ROI Owner, dan
 * itu bukan cacat: dari sudut pemilik, modal yang tidak bekerja adalah hasil yang buruk juga.
 *
 * Sumbernya `roiReports` (baris HARIAN), bukan `roiSnapshots`: baris snapshot kumulatif sejak
 * tengah malam, dan yang menjumlahkannya per periode melipatgandakan pendapatan hari yang sama —
 * alasan yang sama dengan grafik dan Kalender.
 */

// PIC yang tidak tertulis di barisnya. Satu ember, sama seperti `splitByOwner` di profitLoss.js:
// barisnya tetap dihitung sebagai uang yang nyata, tapi tidak bisa dibagi dana karena tidak ada
// orang yang bisa menerimanya.
export const NO_PIC = "(tanpa PIC)";

/** Satu baris per advertiser, plus totalnya. */
export function buildSpendingPlan({
  roiReports = [],
  whitelistTopup = [],
  adAccounts = [],
  users = [],
  range = {},
  nextBudget = 0,
  rate = 0,
} = {}) {
  // Hari BERJALAN dibuang, dan itu bukan kerapian. Laporan hari ini memuat setengah hari earning
  // di atas dana satu hari penuh, jadi ia menekan ROI setiap orang — tapi tidak sama rata:
  // advertiser yang laporan GAM-nya datang lebih lambat terlihat lebih buruk daripada rekannya,
  // dan dana berpindah karena jam, bukan karena hasil. Hari operasinya ikut hilang sendiri, karena
  // jumlah hari di bawah dihitung dari baris yang tersisa.
  const userMap = canonicalUserMap(users);
  const reportList = Array.isArray(roiReports) ? roiReports : Object.values(roiReports || {});
  // "Hari berjalan" adalah hari partial TERBARU, bukan tiap baris bertanda partial — aturan yang sama
  // dengan kolom Total Topup di bawah. Tanda yang membeku di baris hari lampau (subdomainnya tidak
  // muncul lagi di laporan final) akan membuang baris itu dari Spending dan Earning selamanya.
  const runningDay = runningDayKey(reportList);
  const rows = filterByDateWindow(reportList, range).filter(
    (row) => !isRunningRow(row, runningDay),
  );

  const days = new Set();
  for (const row of rows) {
    const day = dayKeyOf(row);
    if (day) days.add(day);
  }
  // Hari yang BENAR-BENAR punya baris, bukan panjang rentang yang dipilih. Rentang 30 hari di atas
  // data 12 hari akan mengalikan dana tiap orang dengan angka yang tidak pernah dikeluarkan
  // siapa pun: urutannya selamat (semua dikali sama), tapi tiap angka di layar berbohong.
  const dayCount = days.size;

  const buckets = new Map();
  const knownPics = new Map();
  for (const row of rows) {
    const rawPic = cellText(row?.pic);
    const pic = resolveUserName(rawPic, userMap) || rawPic;
    const key = normalize(pic) || NO_PIC;
    if (pic && pic !== NO_PIC) {
      knownPics.set(key, pic);
    }
    const entry = ensure(buckets, key, () => newEntry(pic || NO_PIC));
    entry.rows++;

    const money = withAdTax(row, rate);
    if (money.earningKnown) {
      entry.earning += toAmount(money.earning);
      entry.earningRows++;
    } else {
      entry.earningUnknown++;
    }
    if (money.spendingKnown) {
      entry.spending += toAmount(money.spending);
      entry.adTax += toAmount(money.adTax);
      entry.totalSpending += toAmount(money.totalSpending);
      entry.spendingRows++;
    } else {
      entry.spendUnknown++;
    }

    const day = dayKeyOf(row);
    if (day) entry.activeDays.add(day);
  }

  const pool = Math.max(0, Math.round(Number(nextBudget) || 0));
  // Hari berjalan dibuang di sini juga: top-up hari ini dihitung terhadap earning yang masih
  // setengah hari, dan ROI Owner-nya tidak bisa diadu dengan hari yang sudah tutup.
  //
  // Yang dibuang cuma hari partial TERBARU, bukan "semua hari yang punya baris partial" — aturan
  // yang sama dengan `filterRunningDay` di dateRange.js, dan bug yang sama kalau dilanggar. Baris
  // harian yang sempat ditulis sebagai hari berjalan lalu TIDAK pernah ditulis ulang (subdomainnya
  // tidak muncul lagi di laporan hari berikutnya) membeku bertanda `partial: true` selamanya, jadi
  // hampir setiap hari di RTDB punya satu-dua baris begitu. Dibaca sebagai "hari berjalan",
  // seluruh top-up sepuluh hari terakhir ikut terbuang dan kolom Total Topup berbunyi Rp 0 untuk
  // periode yang di halaman Whitelist Top-Up jelas ada isinya.
  const topupData = topupByOwner({
    whitelistTopup,
    adAccounts,
    users,
    knownPics,
    range,
    skipDay: runningDay,
  });

  // Pastikan advertiser yang memiliki top-up pada periode ini ikut muncul di tabel
  // meski belum memiliki baris ROI (mis. modal menganggur / baru disetor).
  for (const [key, amount] of topupData.amounts) {
    if (key === NO_PIC || amount <= 0) continue;
    ensure(buckets, key, () => newEntry(topupData.names.get(key) || key));
  }

  // Saldo yang tersisa di akun, per advertiser. Angka HARI INI dan bukan akhir periode — dan itu
  // benar justru karena pertanyaannya ke depan: "berapa yang perlu ditransfer besok". Karena itu
  // ia tidak boleh masuk ke satu pun kolom yang dijumlah bersama periode terpilih.
  const balanceData = balanceByOwner({ adAccounts, users, knownPics });

  const list = [...buckets].map(([key, entry]) => {
    const earning = entry.earningRows ? round(entry.earning) : "";
    const totalSpending = entry.spendingRows ? round(entry.totalSpending) : "";
    const topup = round(topupData.amounts.get(key) || 0);
    const roiAdvertiser = returnPercent(earning, totalSpending);
    const roiOwner = returnPercent(earning, topup);
    const balanceEntry = balanceData.get(key);

    return {
      key,
      name: entry.name,
      days: dayCount,
      activeDays: entry.activeDays.size,
      // Saldo yang TIDAK diketahui bukan nol, aturan yang sama dengan earning dan spend: nol di
      // sini berarti "akunnya kosong", dan itu klaim yang berbeda dari "tidak ada akun yang
      // mengabarkan saldonya". Yang membedakan keduanya di layar adalah `balanceKnown`.
      balance: balanceEntry?.known ? round(balanceEntry.amount) : "",
      balanceKnown: Boolean(balanceEntry?.known),
      spending: entry.spendingRows ? round(entry.spending) : "",
      adTax: entry.spendingRows ? round(entry.adTax) : "",
      totalSpending,
      earning,
      topup,
      roiOwner,
      roiAdvertiser,
      /**
       * Bobot pembagian: ROI Owner.
       *
       * "(tanpa PIC)" tidak pernah berbobot — uangnya nyata dan ikut total, tapi tidak ada orang
       * yang bisa diserahi; diberi jatah, ia menyerap porsi yang tidak bisa diberikan ke siapa pun
       * dan jumlah kolom Next Budget berhenti sama dengan dana yang benar-benar dibagikan.
       *
       * Baris tanpa earning ATAU tanpa top-up tidak berbobot, bukan berbobot nol: laporan GAM yang
       * gagal datang tanpa earning, dan menghukum advertiser atas kegagalan sync adalah cara
       * tercepat membuat tabel ini berhenti dipercaya.
       */
      weight: key === NO_PIC || roiOwner === "" ? null : roiOwner,
      earningUnknown: entry.earningUnknown,
      spendUnknown: entry.spendUnknown,
      rows: entry.rows,
    };
  });

  const shares = allocate(list, pool);
  for (const row of list) {
    const share = shares.get(row.key);
    row.share = share ? share.percent : "";
    row.nextBudget = share ? share.amount : "";
    // Saldo yang tidak diketahui menghasilkan transfer PENUH, bukan baris kosong: dua arah salahnya
    // tidak setara — mengirim terlalu banyak menumpuk modal, mengirim terlalu sedikit menghentikan
    // iklan di tengah hari. Sebabnya tertulis di bawah namanya (`RowNote`), supaya angka penuh itu
    // tidak terbaca sebagai "akunnya memang kosong".
    row.transfer =
      row.nextBudget === ""
        ? ""
        : Math.max(0, row.nextBudget - (row.balance === "" ? 0 : row.balance));
  }

  list.sort(byWeightThenName);

  return {
    rows: list,
    dayCount,
    // Hari pertama & terakhir yang benar-benar terpakai. Rentang yang dipilih orang belum tentu
    // sama dengan periode yang dihitung (hari berjalan dibuang, hari tanpa baris tidak ada), dan
    // yang menyebutkan periodenya di layar harus menyebut yang KEDUA.
    firstDay: dayCount ? [...days].sort()[0] : "",
    lastDay: dayCount ? [...days].sort().reverse()[0] : "",
    nextBudget: pool,
    allocated: sumBy(list, (row) => (row.nextBudget === "" ? 0 : row.nextBudget)),
    totals: totalsOf(list, dayCount),
    earningUnknown: sumBy(list, (row) => row.earningUnknown),
    spendUnknown: sumBy(list, (row) => row.spendUnknown),
  };
}

/**
 * Berapa kali belanja kembali sebagai pendapatan, dalam persen.
 *
 * `earning ÷ belanja × 100` — rumus spreadsheet acuannya, BUKAN `roiPercent` yang dipakai seluruh
 * dashboard lain (lihat catatan di kepala berkas). Lantai belanjanya tetap `MIN_ROI_SPEND`, alasan
 * yang sama dengan di sana: pembagi yang mendekati nol meledakkan hasilnya — Rp 43 belanja
 * menghasilkan enam angka yang berdiri di kolom yang sama dengan angka yang berarti, dan di sini ia
 * akan menyedot hampir seluruh dana berikutnya ke baris yang paling tidak berarti di tabel.
 */
function returnPercent(earning, spending) {
  if (earning === "" || spending === "" || spending < MIN_ROI_SPEND) return "";
  return round((earning / spending) * 100);
}

/**
 * Porsi tiap baris atas dana berikutnya, sebanding dengan hasilnya.
 *
 * Dibulatkan dengan sisa TERBESAR, bukan dibulatkan satu per satu: kolom yang tidak berjumlah persis
 * sebesar angka yang diketik orang akan diadu dengan angka itu pada detik pertama halaman ini
 * dibuka, dan selisih beberapa rupiah sudah cukup untuk membuat seluruh tabelnya tidak dipercaya.
 */
function allocate(rows, pool) {
  const shares = new Map();
  const weighted = rows.filter((row) => row.weight !== null && row.weight > 0);
  const total = weighted.reduce((sum, row) => sum + row.weight, 0);
  if (!pool || !total) return shares;

  let given = 0;
  const parts = weighted.map((row) => {
    const exact = (pool * row.weight) / total;
    const amount = Math.floor(exact);
    given += amount;
    return {
      key: row.key,
      amount,
      remainder: exact - amount,
      percent: round((row.weight / total) * 100),
    };
  });

  // Sisa pembulatan jatuh ke pecahan terbesar dulu — satu rupiah per baris, sampai habis.
  parts
    .slice()
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, pool - given)
    .forEach((part) => {
      part.amount++;
    });

  for (const part of parts) shares.set(part.key, part);
  return shares;
}

// Baris total: dihitung ulang dari jumlahnya, bukan dirata-ratakan dari kolom di atasnya. Rata-rata
// dari persentase memberi bobot yang sama kepada advertiser bermodal Rp 1 juta dan Rp 100 juta.
function totalsOf(rows, dayCount) {
  const totalSpending = sumBy(rows, (row) => (row.totalSpending === "" ? 0 : row.totalSpending));
  const earning = sumBy(rows, (row) => (row.earning === "" ? 0 : row.earning));
  const knownEarning = rows.some((row) => row.earning !== "");
  const knownSpending = rows.some((row) => row.totalSpending !== "");

  const knownBalance = rows.some((row) => row.balanceKnown);

  return {
    days: dayCount,
    spending: sumBy(rows, (row) => (row.spending === "" ? 0 : row.spending)),
    adTax: sumBy(rows, (row) => (row.adTax === "" ? 0 : row.adTax)),
    totalSpending: knownSpending ? totalSpending : "",
    earning: knownEarning ? earning : "",
    topup: sumBy(rows, (row) => row.topup),
    roiOwner: returnPercent(
      knownEarning ? earning : "",
      sumBy(rows, (row) => row.topup),
    ),
    roiAdvertiser: returnPercent(knownEarning ? earning : "", knownSpending ? totalSpending : ""),
    nextBudget: sumBy(rows, (row) => (row.nextBudget === "" ? 0 : row.nextBudget)),
    balance: knownBalance ? sumBy(rows, (row) => (row.balance === "" ? 0 : row.balance)) : "",
    // Jumlah kolom Perlu Transfer SENGAJA lebih kecil daripada dana yang diketik, dan selisihnya
    // punya nama: uang yang sudah ada di akun. Yang wajib sama persis dengan angka yang diketik
    // adalah kolom Next Budget — itu yang diadu orang dengan kotak isiannya.
    transfer: sumBy(rows, (row) => (row.transfer === "" ? 0 : row.transfer)),
  };
}

function canonicalUserMap(users = []) {
  const map = new Map();
  const list = Array.isArray(users) ? users : Object.values(users || {});
  for (const user of list) {
    if (!user) continue;
    const name = cellText(user.name);
    if (!name) continue;
    for (const key of [user.id, user.uid, user.name, user.username, user.email]) {
      const norm = normalize(key);
      if (norm) map.set(norm, name);
    }
  }
  return map;
}

function resolveUserName(value, userMap) {
  const norm = normalize(value);
  if (!norm) return "";
  return userMap?.get(norm) || cellText(value);
}

function matchAdvertiserKey(owner, knownPics = new Map(), userMap = new Map()) {
  const raw = cellText(owner);
  const norm = normalize(raw);
  if (!norm) return "";

  // 1. Direct match with known PIC key
  if (knownPics.has(norm)) return norm;

  // 2. Canonical resolution via users map
  const canonical = userMap.get(norm);
  if (canonical && knownPics.has(normalize(canonical))) {
    return normalize(canonical);
  }

  // 3. Email prefix matching (e.g. "aca@rabbitracing.live" -> "aca")
  if (norm.includes("@")) {
    const emailPrefix = normalize(norm.split("@")[0]);
    if (knownPics.has(emailPrefix)) return emailPrefix;
    const prefixCanonical = userMap.get(emailPrefix);
    if (prefixCanonical && knownPics.has(normalize(prefixCanonical))) {
      return normalize(prefixCanonical);
    }
  }

  // 4. Fuzzy / word-based matching with known PICs
  // e.g. "Nurjaman" matching "Nurjaman WL 2", or "Nurjaman WL 2" matching "Nurjaman"
  const ownerWords = norm.split(/[\s\-_/]+/).filter((w) => w.length >= 2);
  for (const [picKey] of knownPics) {
    if (picKey.startsWith(norm) || norm.startsWith(picKey)) {
      return picKey;
    }
    const picWords = picKey.split(/[\s\-_/]+/).filter((w) => w.length >= 2);
    if (ownerWords.length > 0 && picWords.length > 0 && ownerWords[0] === picWords[0]) {
      return picKey;
    }
  }

  return canonical ? normalize(canonical) : norm;
}

/**
 * Nominal top-up per advertiser di rentang yang sama dengan tabel.
 *
 * Dicocokkan lewat nama / kode akun (`namaKode` di Whitelist Top-Up yang dicocokkan ke
 * `adAccounts.name`, `adAccounts.actId`, atau `adAccounts.id`) lalu `userOwner`, yang tertulis
 * sama dengan `pic` di baris ROI (mis. "TBZ 1247" atau "TBZ 1233" dicocokkan ke pemiliknya).
 * Akun tanpa pemilik, atau nama yang tidak ada di Ad Accounts, jatuh ke `(tanpa PIC)` — uangnya
 * tetap dijumlah di total, tidak diserahkan ke orang yang salah.
 *
 * Yang dijumlah `nominal`, bukan `total`. Fee 5% dibayar ke pihak lain dan sudah dipisah di
 * halaman Whitelist Top-Up; memasukkannya di sini membuat ROI Owner mengukur setoran + ongkos
 * transfer, bukan uang yang benar-benar masuk ke iklan.
 */
function topupByOwner({
  whitelistTopup = [],
  adAccounts = [],
  users = [],
  knownPics = new Map(),
  range = {},
  skipDay = "",
}) {
  const userMap = canonicalUserMap(users);
  const accountList = Array.isArray(adAccounts) ? adAccounts : Object.values(adAccounts || {});
  const topupList = Array.isArray(whitelistTopup)
    ? whitelistTopup
    : Object.values(whitelistTopup || {});

  const ownerByAccountKey = new Map();
  const accountEntries = [];

  for (const account of accountList) {
    if (!account) continue;
    const rawOwner = cellText(
      account?.userOwner ||
        account?.user_owner ||
        account?.pemilik ||
        account?.pic ||
        account?.owner ||
        account?.user ||
        account?.advertiser ||
        account?.userId ||
        account?.ownerId,
    );
    const owner = resolveUserName(rawOwner, userMap);
    if (!owner) continue;

    const rawName = cellText(
      account?.name ||
        account?.accountName ||
        account?.nama ||
        account?.namaAkun ||
        account?.adAccount ||
        account?.actName ||
        account?.namaKode,
    );
    const rawActId = cellText(
      account?.actId || account?.act_id || account?.account_id || account?.actIdMeta,
    );
    const rawId = cellText(account?.id);
    const rawCode = cellText(
      account?.code || account?.kode || account?.namaKode || account?.nama_kode,
    );

    const keys = new Set();
    for (const raw of [rawName, rawActId, rawId, rawCode]) {
      if (!raw) continue;
      const n1 = normalizeAccount(raw);
      if (n1) keys.add(n1);
      const n2 = stripActPrefix(raw);
      if (n2) keys.add(n2);
    }

    for (const k of keys) {
      ownerByAccountKey.set(k, owner);
    }

    accountEntries.push({
      owner,
      name: rawName,
      actId: rawActId,
      normName: normalizeAccount(rawName),
      normActId: stripActPrefix(rawActId),
      keys,
    });
  }

  const amounts = new Map();
  const names = new Map();

  const topupsInRange = filterByDateWindow(topupList, range);

  for (const row of topupsInRange) {
    const day = dayKeyOf(row);
    if (day && day === skipDay) continue;

    const rawAccount = cellText(
      row?.namaKode ||
        row?.nama_kode ||
        row?.namaAkun ||
        row?.name ||
        row?.nama ||
        row?.account ||
        row?.adAccount ||
        row?.actId ||
        row?.act_id ||
        row?.kode ||
        row?.code,
    );

    // PIC yang TERTULIS di barisnya menang atas semua penebakan di bawahnya. Halaman Whitelist
    // Top-Up punya kolomnya sendiri sekarang, dan satu-satunya alasan penebakan itu ada adalah
    // baris yang ditulis sebelum kolomnya lahir.
    let owner = explicitPic(row, userMap, knownPics);

    // 1. Direct match by account key (name, actId, id, code, etc.)
    if (!owner && rawAccount) {
      const normRaw = normalizeAccount(rawAccount);
      const strippedRaw = stripActPrefix(rawAccount);
      owner = ownerByAccountKey.get(normRaw) || ownerByAccountKey.get(strippedRaw) || "";

      // 2. If not matched, try substring / token matching with known ad accounts
      if (!owner && (normRaw.length >= 3 || strippedRaw.length >= 3)) {
        for (const entry of accountEntries) {
          if (
            (entry.normName &&
              entry.normName.length >= 3 &&
              (normRaw.includes(entry.normName) || entry.normName.includes(normRaw))) ||
            (entry.normActId &&
              entry.normActId.length >= 3 &&
              (strippedRaw.includes(entry.normActId) || entry.normActId.includes(strippedRaw)))
          ) {
            owner = entry.owner;
            break;
          }
        }
      }
    }

    // 3. Fallback: nama/kode-nya sendiri ternyata nama orang (baris lama yang mengetik PIC di
    //    kolom Nama / Kode). Kolom KETERANGAN sengaja tidak ikut dibaca lagi: ia teks bebas berisi
    //    catatan orang, dan satu keterangan yang kebetulan menyebut sebuah nama memindahkan
    //    setoran orang lain ke baris itu — tanpa satu pun tanda di layar selain porsi dana yang
    //    aneh. Yang menggantikannya kolom PIC di halaman Whitelist Top-Up.
    if (!owner) {
      if (rawAccount) {
        const userMatched = resolveUserName(rawAccount, userMap);
        if (userMatched && userMap.has(normalize(rawAccount))) {
          owner = userMatched;
        } else if (knownPics.has(normalize(rawAccount))) {
          owner = knownPics.get(normalize(rawAccount));
        }
      }
    }

    const key = matchAdvertiserKey(owner, knownPics, userMap) || NO_PIC;
    const displayName = knownPics.get(key) || resolveUserName(owner, userMap) || owner;
    const nominal = toAmount(
      row?.nominal ?? row?.amount ?? row?.jumlah ?? row?.total ?? row?.topup,
    );

    amounts.set(key, (amounts.get(key) || 0) + nominal);
    if (owner && !names.has(key)) {
      names.set(key, displayName);
    }
  }

  return { amounts, names };
}

/**
 * PIC yang ditulis orang di baris Whitelist Top-Up (kolom **PIC**).
 *
 * Dibaca SEBELUM pemetaan `namaKode` -> `adAccounts.userOwner`, dan itu urutan yang disengaja:
 * akun whitelist berpindah pemilik, dan pemetaan akun cuma tahu pemilik HARI INI — setoran bulan
 * lalu akan pindah ke orang yang menerima akunnya minggu lalu, dan porsi dana kedua orang itu
 * bergeser tanpa satu pun baris yang berubah di layar. Yang tertulis di barisnya tidak bergeser.
 *
 * Nama yang tidak dikenali TIDAK dibuang: ia dipakai apa adanya, lalu `matchAdvertiserKey` yang
 * mencocokkannya dengan PIC di baris ROI. Yang kosong jatuh kembali ke pemetaan akun — itu keadaan
 * setiap baris yang ditulis sebelum kolom ini ada.
 */
function explicitPic(row, userMap, knownPics) {
  const raw = cellText(row?.pic || row?.userOwner || row?.user);
  if (!raw) return "";
  const norm = normalize(raw);
  if (knownPics.has(norm)) return knownPics.get(norm);
  return resolveUserName(raw, userMap) || raw;
}

/**
 * Sisa saldo tiap advertiser: jumlah `adAccounts.balance` milik akun-akunnya.
 *
 * Bukan saldo uang dalam arti harfiah — yang ditulis sync ke field itu adalah sisa batas
 * pengeluaran Meta (`remaining`), lihat `metaUpdate` di `functions/sync-core.js`. Untuk akun
 * whitelist yang batasnya dinaikkan tiap top-up keduanya bergerak bersamaan; akun yang spend
 * cap-nya pernah diatur tangan tidak, dan di situ kolom ini melaporkan lebih banyak daripada uang
 * yang benar-benar tersisa.
 *
 * Akun yang sync-nya DIMATIKAN (disuspend Meta) dilewati: saldonya beku di angka terakhir sebelum
 * suspend, dan uang di akun yang tidak bisa membelanjakan apa pun bukan uang yang mengurangi
 * transfer berikutnya. Melewatkannya berarti transfer penuh — arah salah yang aman.
 *
 * Pemiliknya dicocokkan lewat `matchAdvertiserKey`, jalur yang sama dengan top-up: satu advertiser
 * boleh punya beberapa akun, dan yang dijumlah adalah semuanya.
 */
function balanceByOwner({ adAccounts = [], users = [], knownPics = new Map() }) {
  const userMap = canonicalUserMap(users);
  const accountList = Array.isArray(adAccounts) ? adAccounts : Object.values(adAccounts || {});
  const byOwner = new Map();

  for (const account of accountList) {
    if (!account || account.syncDisabled) continue;
    const owner = resolveUserName(cellText(account?.userOwner), userMap);
    if (!owner) continue;

    const key = matchAdvertiserKey(owner, knownPics, userMap);
    if (!key) continue;

    const entry = ensure(byOwner, key, () => ({ amount: 0, known: false }));
    const raw = Number(account?.balance);
    if (Number.isFinite(raw)) {
      entry.amount += raw;
      entry.known = true;
    }
  }

  return byOwner;
}

function normalizeAccount(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/[\s\-_:()[\]/]+/g, "");
}

function stripActPrefix(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/^act_?/i, "")
    .replace(/[\s\-_:()[\]/]+/g, "");
}

// Yang paling banyak mendapat dana berdiri paling atas: daftar ini dibaca untuk memutuskan, dan
// keputusan itu tinggal di kolom terakhir. Yang tidak punya bobot jatuh ke bawah, berurut nama.
function byWeightThenName(a, b) {
  const left = a.weight === null ? -1 : a.weight;
  const right = b.weight === null ? -1 : b.weight;
  return right - left || a.name.localeCompare(b.name);
}

function newEntry(name) {
  return {
    name: name || NO_PIC,
    rows: 0,
    earning: 0,
    earningRows: 0,
    earningUnknown: 0,
    spending: 0,
    adTax: 0,
    totalSpending: 0,
    spendingRows: 0,
    spendUnknown: 0,
    activeDays: new Set(),
  };
}

function dayKeyOf(row) {
  const rawDate =
    row?.date ||
    row?.tanggal ||
    row?.reportDate ||
    row?.createdAt ||
    row?.syncedAt ||
    row?.spendDate ||
    row?.periodDate ||
    row?.timestamp;
  const date = parseDateLike(rawDate);
  return date ? toDateKey(date) : "";
}

function normalize(value) {
  return cellText(value).toLowerCase();
}
