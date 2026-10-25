// Kandidat pertama yang benar-benar terisi, dengan "-" sebagai jalan terakhir.
//
// Pola `item.a || item.b || "-"` yang tersebar di tabel memperlakukan 0 sebagai kosong, padahal di
// dashboard ini 0 justru kabar: fluktuasi 0 berarti angkanya tidak bergerak sejak sync terakhir,
// saldo 0 berarti saldonya habis, klik 0 berarti tidak ada yang mengklik. Ketiganya berubah jadi
// "-" — tanda yang sudah punya arti lain di tabel ini, yaitu "datanya memang tidak ada". Dua
// keadaan yang berlawanan jadi terlihat sama, dan yang penting justru yang tersembunyi.
export function firstValue(...candidates) {
  for (const value of candidates) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return "-";
}
