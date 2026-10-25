import { status } from "elysia";
import { campaignEntries } from "../functions/sync-core.js";

/**
 * Baris campaign di dalam profil `userId` — atau alasan kenapa tidak ada.
 *
 * Dipakai saklar campaign/ad set DAN halaman Campaign, dan yang dijaganya sama di semuanya: ID
 * campaign yang datang dari request TIDAK PERNAH dipercaya sebagai alamat Meta. Tanpa pencarian
 * ini, endpoint mana pun jadi proxy Meta untuk campaign apa saja di Business Manager — cukup
 * mengoper ID milik akun orang lain.
 */
export async function campaignRowOf(store, userId, campaignId) {
  const user = await store.read(`users/${userId}`);
  if (!user || user.deletedAt) return { notFound: status(404, { error: "User tidak ditemukan." }) };
  const row = campaignEntries(user.campaigns).find(
    ([, item]) => String(item?.campaignId || "") === String(campaignId),
  )?.[1];
  if (!row) {
    return { user, notFound: status(404, { error: "Campaign ini bukan milik user tersebut." }) };
  }
  return { user, row };
}
