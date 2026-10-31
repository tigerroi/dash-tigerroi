/**
 * Adapter dan normalisasi data modul Accounting (Cost Ad Exchange, Invalid Traffic, Tarif Bonus, dll.)
 */

/**
 * Menyiapkan payload untuk Tarif Bonus (bonus_percents)
 */
export function formatBonusPercentPayload(values = {}) {
  const userName = String(values.user || values.userName || values.user_name || "").trim();
  const effectiveFrom = values.effectiveFrom || values.effective_from || null;
  const month = values.month || (effectiveFrom ? String(effectiveFrom).slice(0, 7) : null);

  return {
    user: userName,
    user_name: userName,
    percent: values.percent !== undefined && values.percent !== "" ? Number(values.percent) : null,
    month,
    effective_from: effectiveFrom,
    note: values.note ? String(values.note).trim() : null,
    status: values.status || "Active",
  };
}

/**
 * Normalisasi baris Tarif Bonus saat dibaca dari database
 */
export function normalizeBonusPercentRow(row = {}) {
  if (!row || typeof row !== "object") return row;
  const user = String(row.user || row.userName || row.user_name || "").trim();
  return {
    ...row,
    user,
    userName: user,
  };
}

/**
 * Menyiapkan payload untuk Biaya Ad Exchange (adx_costs)
 */
export function formatAdxCostPayload(values = {}) {
  const nominal = Number(values.nominal || values.amount || 0);
  const costUsd = Number(values.costUsd || values.cost || 0);

  return {
    domain: values.domain ? String(values.domain).trim() : "",
    date: values.date || null,
    company_name: values.companyName || values.company_name || "",
    ratio: values.ratio ? String(values.ratio).trim() : null,
    cost_usd: costUsd,
    cost: costUsd,
    nominal: nominal,
    amount: nominal,
    approval_status: values.approvalStatus || values.approval_status || "Approve",
    setup_adx: values.setupAdx || values.setup_adx || "Belum",
    setup_sub: values.setupSub || values.setup_sub || "Belum",
    network_code: values.networkCode ? String(values.networkCode).trim() : null,
    email: values.email ? String(values.email).trim() : null,
    note: values.note ? String(values.note).trim() : null,
  };
}

/**
 * Normalisasi baris Biaya Ad Exchange saat dibaca dari database
 */
export function normalizeAdxCostRow(row = {}) {
  if (!row || typeof row !== "object") return row;
  const nominal = Number(row.nominal ?? row.amount ?? 0);
  const costUsd = Number(row.costUsd ?? row.cost ?? 0);

  return {
    ...row,
    nominal,
    amount: nominal,
    costUsd,
    cost: costUsd,
    approvalStatus: row.approvalStatus || row.approval_status || "Approve",
    setupAdx: row.setupAdx || row.setup_adx || "Belum",
    setupSub: row.setupSub || row.setup_sub || "Belum",
    companyName: row.companyName || row.company_name || "",
  };
}

/**
 * Menyiapkan payload untuk Invalid Traffic (invalid_traffic)
 */
export function formatInvalidTrafficPayload(values = {}) {
  const check1 = Number(values.check1 || 0);
  const check2 = Number(values.check2 || 0);
  const check3 = Number(values.check3 || 0);
  const totalNominal = Number(values.nominal || values.amount || (check1 + check2 + check3));

  return {
    domain: values.domain ? String(values.domain).trim() : "",
    month: values.month ? String(values.month).trim() : "",
    date: values.date || (values.month ? `${values.month}-01` : null),
    account_type: values.accountType || values.account_type || "Ad Exchange",
    data_source: values.dataSource || values.data_source || null,
    earning_manual: values.earningManual !== undefined && values.earningManual !== "" ? Number(values.earningManual) : null,
    total_spending_manual: values.totalSpendingManual !== undefined && values.totalSpendingManual !== "" ? Number(values.totalSpendingManual) : null,
    check1,
    check2,
    check3,
    nominal: totalNominal,
    amount: totalNominal,
    note: values.note ? String(values.note).trim() : null,
  };
}

/**
 * Normalisasi baris Invalid Traffic saat dibaca dari database
 */
export function normalizeInvalidTrafficRow(row = {}) {
  if (!row || typeof row !== "object") return row;
  const nominal = Number(row.nominal ?? row.amount ?? 0);

  return {
    ...row,
    nominal,
    amount: nominal,
    accountType: row.accountType || row.account_type || "Ad Exchange",
    dataSource: row.dataSource || row.data_source || null,
    earningManual: row.earningManual ?? row.earning_manual ?? null,
    totalSpendingManual: row.totalSpendingManual ?? row.total_spending_manual ?? null,
    check1: Number(row.check1 || 0),
    check2: Number(row.check2 || 0),
    check3: Number(row.check3 || 0),
  };
}

/**
 * Menyiapkan payload untuk Pengeluaran (expenses)
 */
export function formatExpensePayload(values = {}) {
  const nominal = Number(values.nominal || values.amount || 0);
  const qty = Number(values.qty || 1);
  const total = values.total !== undefined && values.total !== "" ? Number(values.total) : nominal * qty;
  const itemName = String(values.itemName || values.item_name || values.description || "").trim();
  const note = values.note ? String(values.note).trim() : (values.description || "");

  return {
    date: values.date || new Date().toISOString().slice(0, 10),
    item_name: itemName,
    category: values.category || itemName || "Operasional",
    description: note || itemName,
    qty,
    nominal,
    total,
    amount: total || nominal,
    pic: values.pic ? String(values.pic).trim() : null,
    note,
  };
}

/**
 * Normalisasi baris Pengeluaran saat dibaca dari database
 */
export function normalizeExpenseRow(row = {}) {
  if (!row || typeof row !== "object") return row;
  const nominal = Number(row.nominal ?? row.amount ?? 0);
  const qty = Number(row.qty ?? 1);
  const total = Number(row.total ?? (nominal * qty));
  const itemName = row.itemName || row.item_name || row.description || row.category || "";
  const note = row.note || row.description || "";

  return {
    ...row,
    itemName,
    item_name: itemName,
    qty,
    nominal,
    total,
    amount: total,
    note,
  };
}

/**
 * Menyiapkan payload untuk Whitelist Top-Up (whitelist_topup)
 */
export function formatWhitelistTopupPayload(values = {}) {
  const nominal = Number(values.nominal || values.amount || 0);
  const fee = Number(values.feeTopup || values.fee_topup || values.fee || 0);
  const total = values.total !== undefined && values.total !== "" ? Number(values.total) : nominal + fee;
  const namaKode = String(values.namaKode || values.nama_kode || values.account_code || "").trim();

  return {
    date: values.date || new Date().toISOString().slice(0, 10),
    nama_kode: namaKode,
    account_code: namaKode,
    pic: values.pic ? String(values.pic).trim() : null,
    nominal,
    amount: nominal,
    fee,
    fee_topup: fee,
    total,
    note: values.note ? String(values.note).trim() : null,
  };
}

/**
 * Normalisasi baris Whitelist Top-Up saat dibaca dari database
 */
export function normalizeWhitelistTopupRow(row = {}) {
  if (!row || typeof row !== "object") return row;
  const nominal = Number(row.nominal ?? row.amount ?? 0);
  const feeTopup = Number(row.feeTopup ?? row.fee_topup ?? row.fee ?? 0);
  const total = Number(row.total ?? (nominal + feeTopup));
  const namaKode = row.namaKode || row.nama_kode || row.account_code || "";

  return {
    ...row,
    namaKode,
    nama_kode: namaKode,
    account_code: namaKode,
    nominal,
    amount: nominal,
    feeTopup,
    fee_topup: feeTopup,
    fee: feeTopup,
    total,
  };
}


