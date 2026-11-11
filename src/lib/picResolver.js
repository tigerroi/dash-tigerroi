/**
 * Standarisasi nama PIC agar tidak ada duplikasi antara singkatan (Sul, Mul, Man, Nur, Cris)
 * dengan nama resmi 5 orang tim TigerROI:
 * 1. New York City
 * 2. Sullivan
 * 3. Crissthoper
 * 4. Moskov
 * 5. Austin
 */
export function canonicalizePic(raw) {
  const norm = String(raw || "").trim().toLowerCase();
  if (!norm || norm === "-" || norm === "tanpa pic" || norm === "(tanpa pic)") return "";
  if (norm === "sul" || norm.includes("sullivan")) return "Sullivan";
  if (norm === "mul" || norm === "amul" || norm.includes("moskov")) return "Moskov";
  if (norm === "man" || norm.includes("austin")) return "Austin";
  if (norm === "nur" || norm.includes("nurjaman") || norm.includes("new york")) return "New York City";
  if (norm === "cris" || norm.includes("crissthoper")) return "Crissthoper";
  return String(raw || "").trim();
}

/**
 * Menentukan PIC yang sah untuk suatu baris data berdasarkan tanggal transaksi dan masa aktif PIC.
 * Mencegah advertiser baru (seperti Crissthoper yang baru join di November 2026)
 * menanggung spending & performa lampau (misal bulan Oktober) ketika subdomain belum memiliki PIC.
 */
export function resolveRowPic(row, subDomain, picOf, users = []) {
  let pic = String(row?.pic || (picOf ? picOf(subDomain) : "") || "").trim();
  pic = canonicalizePic(pic);
  if (!pic) {
    return "";
  }

  const rowDate = String(row?.date || row?.month || "").slice(0, 10);
  const normPic = pic.toLowerCase();

  // 1. Aturan Khusus Crissthoper: baru bergabung 1 November 2026.
  // Di bulan Oktober 2026 dan sebelumnya, subdomain belum memiliki PIC.
  if (
    (normPic.includes("crissthoper") || normPic.includes("cris")) &&
    rowDate &&
    rowDate < "2026-11-01"
  ) {
    return "";
  }

  // 2. Pemeriksaan dinamis berdasarkan tanggal pendaftaran/join profil pengguna di Supabase
  const matchedUser = (Array.isArray(users) ? users : []).find((u) => {
    const uName = String(u?.name || "").trim().toLowerCase();
    return uName && (uName === normPic || normPic.includes(uName));
  });

  if (matchedUser) {
    const joinDateRaw =
      matchedUser.joinDate ||
      matchedUser.join_date ||
      matchedUser.createdAt ||
      matchedUser.created_at;

    if (joinDateRaw) {
      const joinMonth = String(joinDateRaw).slice(0, 7); // misal "2026-11"
      const rowMonth = rowDate.slice(0, 7); // misal "2026-10"
      if (rowMonth && rowMonth < joinMonth) {
        return "";
      }
    }
  }

  return pic;
}

