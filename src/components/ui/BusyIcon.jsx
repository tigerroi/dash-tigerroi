import { Loader2 } from "lucide-react";

// Ikon tombol yang berganti jadi spinner selama permintaannya berjalan. Diganti DI TEMPAT, bukan
// ditambahkan di sebelahnya: tombol yang melebar saat ditekan menggeser tetangganya tepat saat orang
// mungkin sedang mengarahkan kursor ke sana. `.icon-spin` berhenti sendiri di bawah
// `prefers-reduced-motion`.
export function BusyIcon({ busy, icon: Icon, size = 15 }) {
  return busy ? <Loader2 className="icon-spin" size={size} /> : <Icon size={size} />;
}
