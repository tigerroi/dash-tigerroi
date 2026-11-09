/**
 * Helper pencatatan snapshot ROI per eksekusi sinkronisasi GitHub Actions.
 * Menyimpan titik data kumulatif pada jam eksekusi tersebut ke tabel `roi_snapshots`,
 * sehingga tabel Laporan ROI Realtime di dashboard dapat menampilkan riwayat
 * jam-jam sebelumnya dari 00:00 sampai 23:59 tanpa saling menimpa.
 */

export function getWibDateTime(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
  // Standarkan waktu snapshot tepat per jam (:00) dari 00:00 s/d 23:00 agar riwayat rapi jam demi jam
  const timeStr = `${partMap.hour}:00`;

  return { date: dateStr, time: timeStr };
}

/**
 * Mencatat snapshot performa dari `view_daily_roi` ke `roi_snapshots`
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} [targetDate] Tanggal target (default: hari ini WIB)
 */
export async function recordRoiSnapshot(supabase, targetDate) {
  const { date: todayWib, time: currentTimeWib } = getWibDateTime();
  const dateToRecord = targetDate || todayWib;

  console.log(`\n📸 [SNAPSHOT] Mencatat riwayat snapshot ROI untuk tanggal ${dateToRecord} jam ${currentTimeWib} WIB...`);

  // 1. Ambil data terkini hari ini dari view_daily_roi
  const { data: currentRows, error: viewErr } = await supabase
    .from("view_daily_roi")
    .select("*")
    .eq("date", dateToRecord);

  if (viewErr) {
    console.error(`⚠️ [SNAPSHOT] Gagal membaca view_daily_roi: ${viewErr.message}`);
    return;
  }

  if (!currentRows || currentRows.length === 0) {
    console.log(`ℹ️ [SNAPSHOT] Tidak ada data di view_daily_roi untuk tanggal ${dateToRecord}. Snapshot dilewati.`);
    return;
  }

  // 2. Ambil snapshot sebelumnya pada hari yang sama untuk menghitung fluktuasi
  const { data: prevSnapshots, error: prevErr } = await supabase
    .from("roi_snapshots")
    .select("sub_domain, site_code, spending, earning, roi, time")
    .eq("date", dateToRecord)
    .lt("time", currentTimeWib)
    .order("time", { ascending: false });

  if (prevErr) {
    console.warn(`⚠️ [SNAPSHOT] Peringatan: Gagal membaca riwayat snapshot sebelumnya: ${prevErr.message}`);
  }

  // Petakan snapshot sebelumnya per subdomain
  const prevMap = new Map();
  for (const prev of prevSnapshots || []) {
    const key = `${prev.site_code}__${prev.sub_domain || ""}`;
    if (!prevMap.has(key)) {
      prevMap.set(key, prev);
    }
  }

  const ROOT_DOMAINS = new Set([
    "tiktokmodapk.net",
    "tacobellmenuu.us",
    "ihopmenuwithprices.us",
    "cmhhealths.com",
    "uniqueinfo24.com",
    "trayedit.com",
  ]);

  // 3. Susun data snapshot baru (Hanya untuk subdomain iklan aktif, abaikan domain utama & campaign off)
  const validRows = currentRows.filter((row) => {
    const sub = String(row.sub_domain || row.subdomain || "").trim().toLowerCase();
    if (!sub || ROOT_DOMAINS.has(sub)) return false;
    const parts = sub.split(".").filter(Boolean);
    if (parts.length <= 2) return false; // Domain utama tanpa subdomain

    const spending = Number(row.spending || row.meta_spend || row.spend_idr || 0);

    // Jangan catat snapshot jika spending 0 (tidak ada campaign iklan aktif)
    if (spending <= 0.01) {
      return false;
    }

    return true;
  });

  const snapshotRows = validRows.map((row) => {
    const sub = row.sub_domain || row.subdomain || "";
    const site = row.site_code || "";
    const safeTimeKey = currentTimeWib.replace(":", "-");
    const snapshotId = `${dateToRecord}T${safeTimeKey}__${site}__${sub || "root"}`;

    const prev = prevMap.get(`${site}__${sub}`);
    const spending = Number(row.spending || row.meta_spend || 0);
    const earning = Number(row.earning || row.gam_revenue || 0);
    const roi = Number(row.roi || 0);

    const flukSpend = prev ? Math.round((spending - Number(prev.spending || 0)) * 100) / 100 : 0;
    const flukEarn = prev ? Math.round((earning - Number(prev.earning || 0)) * 100) / 100 : 0;
    const flukRoi = prev ? Math.round((roi - Number(prev.roi || 0)) * 100) / 100 : 0;

    return {
      id: snapshotId,
      date: dateToRecord,
      time: currentTimeWib,
      site_code: site,
      sub_domain: sub,
      campaign: row.campaign || site,
      domain: row.domain || "-",
      pic: row.pic || "-",
      spending,
      meta_spend: spending,
      ad_tax: Number(row.ad_tax) > 0 ? Number(row.ad_tax) : Math.round(spending * 0.05),
      total_spending: Number(row.total_spending) > spending
        ? Number(row.total_spending)
        : Math.round(spending + (Number(row.ad_tax) || Math.round(spending * 0.05))),
      earning,
      gam_revenue: earning,
      adsense_revenue: 0,
      profit: Math.round(
        earning -
          (Number(row.total_spending) > spending
            ? Number(row.total_spending)
            : Math.round(spending + (Number(row.ad_tax) || Math.round(spending * 0.05)))),
      ),
      roi,
      clicks: Number(row.meta_clicks || row.clicks || 0),
      meta_clicks: Number(row.meta_clicks || row.clicks || 0),
      gam_clicks: Number(row.gam_clicks || 0),
      gam_impressions: Number(row.gam_impressions || row.impressions || 0),
      impressions: Number(row.gam_impressions || row.impressions || 0),
      ctr: Number(row.ctr || 0),
      cpc: Number(row.cpc || 0),
      cpr: Number(row.cpr || 0),
      ecpm: Number(row.ecpm || row.page_rpm || 0),
      currency: row.currency || "IDR",
      fx_rate: Number(row.fx_rate || 1.0),
      fluk_spend: flukSpend,
      fluk_earn: flukEarn,
      fluk_roi: flukRoi,
      created_at: new Date().toISOString(),
    };
  });

  // 4. Upsert snapshot ke tabel roi_snapshots
  const { error: insertErr } = await supabase
    .from("roi_snapshots")
    .upsert(snapshotRows, { onConflict: "id" });

  if (insertErr) {
    console.error(`❌ [SNAPSHOT] Gagal menyimpan ke roi_snapshots: ${insertErr.message}`);
    return;
  }

  console.log(`✅ [SNAPSHOT] Berhasil menyimpan ${snapshotRows.length} baris snapshot waktu ${currentTimeWib} WIB.`);

  // 5. Pembersihan riwayat lama (> 60 hari)
  // Catatan: Jangan pernah menghapus baris snapshot jam-jam sebelumnya (00:00 s/d 23:00) pada hari berjalan!
  try {
    const cutoffDate = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const { error: pruneErr } = await supabase
      .from("roi_snapshots")
      .delete()
      .lt("date", cutoffDate);

    if (!pruneErr) {
      console.log(`🧹 [SNAPSHOT] Pembersihan riwayat snapshot sebelum ${cutoffDate} selesai.`);
    }
  } catch (err) {
    console.warn(`⚠️ [SNAPSHOT] Gagal melakukan pruning snapshot: ${err.message}`);
  }
}

/**
 * Menyimpan riwayat snapshot per jam dari laporan historical GAM (Opsi 2: Keliatan Seharian).
 * Menghitung akumulasi kumulatif jam demi jam (00:00 s/d 23:00) dan mencatatnya ke `roi_snapshots`.
 */
export async function recordHourlyGamSnapshots(supabase, hourlyGamRows, subdomains, sites) {
  if (!hourlyGamRows || hourlyGamRows.length === 0) {
    return;
  }

  console.log(`\n🕒 [HOURLY GAM] Mengolah ${hourlyGamRows.length} baris data per jam GAM ke roi_snapshots...`);

  // Subdomain & Site Map
  const subMap = new Map();
  for (const s of subdomains || []) {
    if (s.name) subMap.set(s.name.toLowerCase().trim(), s);
  }
  const siteMap = new Map();
  for (const st of sites || []) {
    if (st.site_code) siteMap.set(st.site_code.toLowerCase().trim(), st);
  }

  // Kelompokkan data per date + site_code + subdomain + hour
  const hourlyGroup = new Map();
  for (const row of hourlyGamRows) {
    const d = row.date;
    const h = String(row.hour || "00").padStart(2, "0");
    const site = (row.siteCode || "").toLowerCase().trim();
    const sub = (row.subdomainName || "").toLowerCase().trim();
    const key = `${d}__${site}__${sub}`;

    if (!hourlyGroup.has(key)) {
      hourlyGroup.set(key, {
        date: d,
        site_code: site,
        sub_domain: sub,
        hours: new Map(),
      });
    }

    const group = hourlyGroup.get(key);
    if (!group.hours.has(h)) {
      group.hours.set(h, { revenue: 0, impressions: 0, clicks: 0 });
    }
    const hData = group.hours.get(h);
    hData.revenue += Number(row.totalRevenue || 0);
    hData.impressions += Number(row.impressions || 0);
    hData.clicks += Number(row.clicks || 0);
  }

  // Ambil snapshot yang sudah ada di database untuk tanggal tersebut agar data spending Meta tidak tertimpa Rp 0
  const dates = [...new Set(hourlyGamRows.map((r) => r.date).filter(Boolean))];
  const { data: existingSnaps } = await supabase
    .from("roi_snapshots")
    .select("*")
    .in("date", dates);

  const existingMap = new Map();
  for (const s of existingSnaps || []) {
    existingMap.set(s.id, s);
    const sub = (s.sub_domain || "").toLowerCase().trim();
    const timeNorm = (s.time || "").slice(0, 5);
    existingMap.set(`${s.date}__${timeNorm}__${sub}`, s);
  }

  // Hitung kumulatif sepanjang hari dan siapkan baris snapshot
  const snapshotRows = [];
  for (const group of hourlyGroup.values()) {
    const subObj = subMap.get(group.sub_domain);
    const siteObj = siteMap.get(group.site_code);
    const parentDomain = subObj?.parent_domain || siteObj?.domain || "-";
    const pic = subObj?.pic || siteObj?.pic || "-";
    const campaign = group.site_code;

    // Urutkan jam dari 00 sampai 23
    const sortedHours = Array.from(group.hours.keys()).sort();
    let cumulativeRev = 0;
    let cumulativeImp = 0;
    let cumulativeClicks = 0;

    for (const h of sortedHours) {
      const hData = group.hours.get(h);
      const hourRev = Math.round(hData.revenue);
      cumulativeRev += hourRev;
      cumulativeImp += hData.impressions;
      cumulativeClicks += hData.clicks;

      const timeStr = `${h}:00`;
      const snapshotId = `${group.date}T${h}-00__${group.site_code}__${group.sub_domain || "root"}`;
      const existing = existingMap.get(snapshotId) || existingMap.get(`${group.date}__${timeStr}__${group.sub_domain}`);

      // Pertahankan spending Meta yang sudah dicatat sebelumnya pada jam tersebut
      const spending = existing ? Number(existing.spending || existing.meta_spend || 0) : 0;
      
      // Jangan catat snapshot jika spending 0 (tidak ada campaign iklan aktif, abaikan sisa earning organik)
      if (spending <= 0.01) {
        continue;
      }

      const metaSpend = existing ? Number(existing.meta_spend || spending) : 0;
      const adTax = existing ? Number(existing.ad_tax || Math.round(spending * 0.05)) : Math.round(spending * 0.05);
      const totalSpending = existing ? Number(existing.total_spending || (spending + adTax)) : (spending + adTax);
      const metaClicks = existing ? Number(existing.meta_clicks || existing.clicks || 0) : 0;
      const cpr = existing && Number(existing.cpr) > 0 ? Number(existing.cpr) : (metaClicks > 0 ? Math.round((totalSpending / metaClicks) * 100) / 100 : 0);

      const earning = cumulativeRev;
      const profit = Math.round(earning - totalSpending);
      const roi = totalSpending > 0 ? Math.round(((earning - totalSpending) / totalSpending) * 10000) / 100 : 0;

      const ctr = cumulativeImp > 0 ? Math.round((cumulativeClicks / cumulativeImp) * 10000) / 100 : 0;
      const cpc = cumulativeClicks > 0 ? Math.round((earning / cumulativeClicks) * 100) / 100 : 0;
      const ecpm = cumulativeImp > 0 ? Math.round(((earning / cumulativeImp) * 1000) * 100) / 100 : 0;

      snapshotRows.push({
        id: snapshotId,
        date: group.date,
        time: timeStr,
        site_code: group.site_code,
        sub_domain: group.sub_domain,
        campaign,
        domain: parentDomain,
        pic: existing?.pic && existing.pic !== "-" ? existing.pic : pic,
        spending,
        meta_spend: metaSpend,
        ad_tax: adTax,
        total_spending: totalSpending,
        earning,
        gam_revenue: earning,
        adsense_revenue: 0,
        profit,
        roi,
        clicks: metaClicks,
        meta_clicks: metaClicks,
        gam_clicks: cumulativeClicks,
        gam_impressions: cumulativeImp,
        impressions: cumulativeImp,
        ctr,
        cpc,
        cpr,
        ecpm,
        currency: "IDR",
        fx_rate: 1.0,
        fluk_spend: existing?.fluk_spend || 0,
        fluk_earn: hourRev, // Pendapatan pada 1 jam tersebut
        fluk_roi: existing?.fluk_roi || 0,
        created_at: existing?.created_at || new Date().toISOString(),
      });
    }
  }

  if (snapshotRows.length > 0) {
    console.log(`💾 [HOURLY GAM] Menyimpan ${snapshotRows.length} baris snapshot per jam ke tabel roi_snapshots...`);
    const { error: upsertErr } = await supabase
      .from("roi_snapshots")
      .upsert(snapshotRows, { onConflict: "id" });

    if (upsertErr) {
      console.warn(`⚠️ [HOURLY GAM] Gagal menyimpan baris per jam ke roi_snapshots: ${upsertErr.message}`);
    } else {
      console.log(`✅ [HOURLY GAM] Sukses menyimpan riwayat per jam seharian ke roi_snapshots!`);
    }
  }
}

