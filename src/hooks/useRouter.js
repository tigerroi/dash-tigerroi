import { useSyncExternalStore } from "react";
import { locationPath, navigateTo, subscribeLocation } from "../lib/browserLocation";

export function useRouter() {
  // Alamat apa adanya. "/" dulu dipetakan paksa ke "/login" di sini, dan itu membuat pintu masuk
  // default hosting (semua alamat diarahkan ke index.html) selalu menampilkan form login — juga
  // untuk sesi yang masih hidup. resolveRoute sudah membaca "/" sebagai dashboard, jadi tidak ada
  // yang perlu dipetakan di sini; yang belum login tetap dapat LoginPage karena App memutuskannya
  // dari ada-tidaknya sesi, bukan dari alamatnya.
  //
  // Sumbernya `browserLocation`, bukan `useState` sendiri: filter dan pencarian tinggal di query
  // alamat yang sama (lihat `useUrlState`), dan dua penyimpan yang tidak saling mengabari berarti
  // salah satunya selalu basi.
  const path = useSyncExternalStore(subscribeLocation, locationPath, () => "/");

  // `replace` dipakai pengalihan alamat lama ke alamat kanonik. Dengan pushState, alamat lamanya
  // tetap tinggal di riwayat — tombol Back mengembalikan orang ke sana, efek pengalihannya jalan
  // lagi, dan mundur jadi tidak pernah bisa.
  //
  // Perpindahan halaman TIDAK membawa query halaman sebelumnya: `?q=masse` milik /plugin tidak
  // berarti apa-apa di /users, dan riwayatnya yang menyimpan daftar tersaring itu — bukan alamat
  // berikutnya. `navigateTo` fungsi modul, jadi identitasnya sudah tetap antar render.
  return { path, navigate: navigateTo };
}
