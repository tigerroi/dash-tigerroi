/**
 * Normalisasi ID Akun Meta agar selalu berformat kanonik (contoh: "act_123456789")
 */
export function normalizeActId(rawId) {
  const trimmed = String(rawId || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

/**
 * Normalisasi baris ad_accounts dari PostgreSQL Supabase ke format dashboard frontend
 */
export function normalizeAdAccountRow(row) {
  if (!row || typeof row !== "object") return row;

  const actId = normalizeActId(row.actId || row.accountId || row.account_id || row.act_id || "");
  const isDisabled =
    row.syncDisabled !== undefined
      ? Boolean(row.syncDisabled)
      : row.status === "INACTIVE" || row.sync_disabled === true;
  const rawOwner = String(row.userOwner || row.user_owner || "").trim();
  const userOwner = !rawOwner || rawOwner.toLowerCase() === "tanpa pemilik (opsional)" ? "Semua User" : rawOwner;

  const spendCap = Number(row.spendCap ?? row.spend_cap ?? 0);
  const amountSpent = Number(row.amountSpent ?? row.amount_spent ?? 0);
  const rawBalance = Number(row.balance ?? 0);

  // Sisa saldo dihitung dari Account Spending Limit (spend_cap - amount_spent) sesuai aturan Meta Ads
  const remainingBudget =
    spendCap > 0 ? Math.max(0, Math.round((spendCap - amountSpent) * 100) / 100) : rawBalance;

  return {
    ...row,
    actId,
    accountId: actId,
    userOwner,
    syncDisabled: isDisabled,
    syncStatus: row.syncStatus || (isDisabled ? "Nonaktif" : "Aktif"),
    spendCap,
    amountSpent,
    balance: remainingBudget,
    amountDue: rawBalance,
  };
}

/**
 * Menyiapkan payload untuk tabel ad_accounts di Supabase PostgreSQL
 */
export function formatAdAccountPayload(values = {}) {
  const rawId = values.actId || values.accountId || values.account_id || values.act_id || "";
  const normalizedId = normalizeActId(rawId);
  const isSyncDisabled = Boolean(values.syncDisabled);
  let rawOwner = values.userOwner;
  if (Array.isArray(rawOwner)) {
    rawOwner = rawOwner.filter(Boolean).join(", ");
  }
  const strOwner = String(rawOwner || "").trim();
  const userOwner = !strOwner || strOwner.toLowerCase() === "tanpa pemilik (opsional)" ? "Semua User" : strOwner;

  return {
    name: values.name ? String(values.name).trim() : "",
    account_id: normalizedId,
    act_id: normalizedId,
    user_owner: userOwner,
    currency: values.currency || "IDR",
    status: isSyncDisabled ? "INACTIVE" : "ACTIVE",
    sync_disabled: isSyncDisabled,
  };
}

