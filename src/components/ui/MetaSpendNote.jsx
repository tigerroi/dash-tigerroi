// Kenapa kolom META ADS sebuah baris ROI kosong.
//
// Dipakai tabel ROI Overview dan "Report Master Realtime ROI" di Profile User — keduanya membaca
// baris yang sama dari dashboard/roiReports, jadi keduanya harus memberi alasan yang sama. Tanpa
// catatan ini sel kosongnya tidak bisa dibedakan dari spend Rp 0, dan itu selisih antara
// "subdomain ini tidak diiklankan" dan "uangnya keluar tapi tidak tercatat".
// Bunyinya mengikuti alasan yang dibawa barisnya sendiri; baris lama (ditulis sebelum sync
// menandainya) tidak menyebut sebab yang tidak ia ketahui.
export function MetaSpendNote({ reason }) {
  if (reason === "unavailable") {
    return (
      <em
        className="cell-note"
        title="Spend Meta untuk hari ini gagal diambil pada sync terakhir, jadi angka yang ada tidak diperbarui. Rinciannya ada di ikon peringatan pada topbar."
      >
        spend gagal diambil
      </em>
    );
  }

  return (
    <em
      className="cell-note muted"
      title="Tidak ada campaign Meta yang mengarah ke subdomain ini pada hari itu — subdomainnya memang tidak diiklankan, atau Kode Campaign-nya belum terdaftar di /sub-domains → Edit. Bukan kegagalan sync, dan bukan spend Rp 0."
    >
      tanpa campaign Meta
    </em>
  );
}
