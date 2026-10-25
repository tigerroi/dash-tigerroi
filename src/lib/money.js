// Uang yang dipadatkan: "Rp 4,2jt" untuk tempat yang lebarnya diukur puluhan piksel — sumbu grafik
// dan sel kalender, yang tingginya harus memuat tiga baris lain di bawahnya.
//
// Satuannya DISEBUT ("rb"/"jt"), bukan angka telanjang: "Rp 4,2" di sel yang bersebelahan dengan
// "Rp 950rb" terbaca sebagai empat rupiah, dan tidak ada apa pun di layar yang membantah.
//
// Berdiri di lib-nya sendiri karena dipakai dua tempat yang tidak saling mengimpor (grafik per
// subdomain dan kalender laporan). Angka yang sama dipadatkan dengan dua aturan berbeda akan
// membuat satu subdomain berbunyi "Rp 1,4jt" di grafik dan "Rp 1jt" di kalender pada hari yang
// sama — dua angka yang mengaku hal yang sama.
export function compactRupiah(value) {
  const amount = Number(value) || 0;

  if (Math.abs(amount) >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`;
  }

  if (Math.abs(amount) >= 1000) {
    return `Rp ${Math.round(amount / 1000).toLocaleString("id-ID")}rb`;
  }

  return `Rp ${amount.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}
