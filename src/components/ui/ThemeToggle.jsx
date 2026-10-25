import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

// Ikon dan labelnya menyebut tema TUJUAN, bukan tema yang sedang berlaku. Dua kebiasaan sama-sama
// beredar di luar sana ("matahari = sedang terang" vs "matahari = klik untuk terang"), dan tombol
// yang ikonnya saja selalu bisa dibaca terbalik — yang memutuskan artinya di sini adalah labelnya,
// yang berbunyi lengkap sebagai kalimat perintah.
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const target = theme === "dark" ? "terang" : "gelap";
  const label = `Ganti ke tema ${target}`;

  return (
    <button
      aria-label={label}
      className="theme-toggle"
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
