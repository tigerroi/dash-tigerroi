/**
 * Daftar URL cloaking yang ditempel orang (satu per baris) → yang baru dan yang ditolak.
 *
 * Yang sudah ada di daftar dibuang diam-diam: menempel ulang daftar yang sama tidak boleh
 * menggandakan barisnya, karena landing lalu memilih URL itu dua kali lebih sering.
 */
export function parseCloakingUrls(text, existing = []) {
  const seen = new Set(existing.map((row) => String(row?.url ?? "").trim()));
  const fresh = [];
  const invalid = [];

  for (const line of String(text ?? "").split(/[\r\n]+/)) {
    const url = line.trim();
    if (!url) continue;
    if (!isHttpUrl(url)) {
      invalid.push(url);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    fresh.push(url);
  }

  return { fresh, invalid };
}

function isHttpUrl(text) {
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
