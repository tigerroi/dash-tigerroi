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
  const timeStr = `${partMap.hour}:${partMap.minute}`;

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

  // 3. Susun data snapshot baru
  const snapshotRows = currentRows.map((row) => {
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
      ad_tax: Number(row.ad_tax || 0),
      total_spending: Number(row.total_spending || spending),
      earning,
      gam_revenue: earning,
      adsense_revenue: 0,
      profit: Number(row.profit || earning - spending),
      roi,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      cpc: Number(row.cpc || 0),
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

  // 5. Pembersihan riwayat lama (retensi 7 hari agar kapasitas Supabase Free tetap hemat)
  try {
    const cutoffDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { error: pruneErr } = await supabase
      .from("roi_snapshots")
      .delete()
      .lt("date", cutoffDate);

    if (!pruneErr) {
      console.log(`🧹 [SNAPSHOT] Pembersihan riwayat snapshot sebelum ${cutoffDate} selesai.`);
    }
  } catch (err) {
    console.warn(`⚠️ [SNAPSHOT] Gagal melakukan pruning snapshot lama: ${err.message}`);
  }
}
