import { matchNavItem, navTabLabel, pageTabs } from "../../config/navigation";

/**
 * Tab di kepala halaman untuk menu yang digabung ke satu baris sidebar.
 *
 * Ia BUKAN tab dalam arti panel yang berganti isi tanpa pindah alamat: tiap tab adalah halaman
 * sungguhan dengan route-nya sendiri, dan yang berganti di sini cuma cara mencapainya. Itu yang
 * membuat `/whitelist-topup/new`, tombol Back, dan tautan yang sudah beredar tetap bekerja persis
 * seperti sebelum menunya digabung — sepola dengan filter yang tinggal di alamat (CLAUDE.md):
 * keadaan yang tidak ada di alamat tidak bisa dikembalikan.
 *
 * `navigate` dipakai dengan bawaannya (push, bukan replace), alasan yang sama dengan `?situs=` di
 * /plugin: berpindah tab adalah membuka isi lain, jadi Back harus mengembalikan orang ke tab
 * sebelumnya.
 *
 * ═══ `badges`: ANGKA YANG MENUNTUT TINDAKAN, BUKAN JUMLAH BARIS ═══
 *
 * Peta `{ alamat: angka }`, dan yang berhak masuk ke sana cuma tab yang isinya ANTREAN — sesuatu
 * yang menunggu dikerjakan dan habis begitu dikerjakan. Tab yang isinya daftar (Orang, Topik) tidak
 * boleh punya lencana: angka yang tidak pernah berubah jadi nol berhenti dibaca dalam sehari, dan
 * yang ikut berhenti dibaca adalah lencana di sebelahnya yang benar-benar berarti.
 *
 * Nol TIDAK digambar — bukan digambar sebagai "0". Yang dikabarkan lencana ini adalah "ada yang
 * menunggu"; lencana nol mengabarkan hal yang sama dengan tidak adanya lencana, sambil menambah
 * satu benda di layar yang harus dibaca dulu sebelum diabaikan.
 */
export function PageTabs({ badges, canRead, navigate, path }) {
  const tabs = pageTabs(path, canRead);
  if (tabs.length === 0) {
    return null;
  }

  // Halaman anak dari sebuah tab (`/whitelist-topup/new`) tetap menyalakan tab induknya — yang
  // sedang dibuka memang isi tab itu.
  //
  // Lewat `matchNavItem`, yang memilih item TERDALAM, bukan `find` yang berhenti di kecocokan
  // pertama: tab yang alamatnya berada di bawah alamat induknya (`/dashboard/roi` di bawah
  // `/dashboard`) membuat induk cocok lebih dulu, dan yang menyala adalah tab yang salah.
  const active = matchNavItem(path);

  return (
    <nav aria-label="Bagian halaman" className="page-tabs">
      {tabs.map((tab) => (
        <button
          aria-current={tab === active ? "page" : undefined}
          className={tab === active ? "page-tab active" : "page-tab"}
          key={tab.path}
          onClick={() => navigate(tab.path)}
          type="button"
        >
          {navTabLabel(tab)}
          {badges?.[tab.path] > 0 && <span className="page-tab-badge">{badges[tab.path]}</span>}
        </button>
      ))}
    </nav>
  );
}
