// `home` dari `homePath(role)`: untuk akun tamu /dashboard sendiri tertutup, dan tombol yang
// kembali ke halaman "Akses ditolak" lain bukan jalan keluar.
export function EmptyPage({
  navigate,
  home = "/dashboard",
  title = "Page not found",
  description = "Route ini belum tersedia.",
}) {
  return (
    <section className="panel empty-page">
      <h1>{title}</h1>
      <p>{description}</p>
      <button className="primary-button" onClick={() => navigate(home)} type="button">
        Back to Dashboard
      </button>
    </section>
  );
}
