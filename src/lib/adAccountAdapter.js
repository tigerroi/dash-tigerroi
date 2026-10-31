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

  return {
    ...row,
    actId,
    accountId: actId,
    syncDisabled: isDisabled,
    syncStatus: row.syncStatus || (isDisabled ? "Nonaktif" : "Aktif"),
  };
}

/**
 * Menyiapkan payload untuk tabel ad_accounts di Supabase PostgreSQL
 */
export function formatAdAccountPayload(values = {}) {
  const rawId = values.actId || values.accountId || values.account_id || values.act_id || "";
  const normalizedId = normalizeActId(rawId);
  const isSyncDisabled = Boolean(values.syncDisabled);

  return {
    name: values.name ? String(values.name).trim() : "",
    account_id: normalizedId,
    act_id: normalizedId,
    user_owner: values.userOwner ? String(values.userOwner).trim() : null,
    currency: values.currency || "IDR",
    status: isSyncDisabled ? "INACTIVE" : "ACTIVE",
    sync_disabled: isSyncDisabled,
  };
}
