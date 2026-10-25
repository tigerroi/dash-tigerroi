import { Component } from "react";

// Satu error saat render menjatuhkan seluruh pohon React — tanpa penangkap, yang tersisa di layar
// adalah halaman putih tanpa satu kata pun. Itu bukan risiko teoretis di sini: hampir seluruh isi
// Overview dan UserDetail adalah turunan data sync yang bentuknya bisa berubah (RTDB
// mengembalikan array jarang sebagai objek, earning bisa kosong, campaign bisa null). Satu asumsi
// yang meleset di sana seharusnya merusak satu tabel, bukan menghilangkan dashboardnya.
//
// Kelas, bukan fungsi: getDerivedStateFromError/componentDidCatch tidak punya padanan hook.
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Pesannya sudah tampil di layar; yang hanya ada di sini adalah jejak komponennya, dan itulah
    // yang menunjuk baris penyebabnya.
    console.error("[RabbitROI] render gagal:", error, info?.componentStack);
  }

  // Berpindah halaman memulihkan sendiri penangkap ini, jadi menu di samping tetap jadi jalan
  // keluar. Dibanding memberi `key` pada anaknya, cara ini tidak me-remount apa pun selama tidak
  // ada error — halaman yang sehat tidak boleh kehilangan isi kotak pencarian dan posisi
  // halamannya hanya karena ada penangkap di atasnya.
  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    // `fullScreen` dipakai penangkap terluar, yang menangkap kegagalan DashboardShell sendiri —
    // di situ tidak ada sidebar yang tersisa untuk dipakai berpindah.
    const { fullScreen } = this.props;
    const panel = (
      <section className="panel error-boundary">
        <h2>{fullScreen ? "Dashboard gagal dimuat" : "Halaman ini gagal ditampilkan"}</h2>
        <p>
          {fullScreen
            ? "Yang gagal tampilannya, bukan datanya. Muat ulang halaman ini."
            : "Yang gagal hanya isi halaman ini — menu di samping masih bisa dipakai berpindah."}{" "}
          Kalau setelah dimuat ulang masih sama, kirimkan pesan di bawah ini beserta halaman yang
          sedang dibuka.
        </p>
        <p className="error-boundary-message">{String(error?.message || error)}</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          Muat ulang halaman
        </button>
      </section>
    );

    return fullScreen ? <div className="error-screen">{panel}</div> : panel;
  }
}
