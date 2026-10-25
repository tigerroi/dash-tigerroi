import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { notifyError } from "../../lib/notify";

const COPIED_MS = 1500;

/**
 * Satu-satunya tombol salin ke papan klip. Ditulis tiga kali sebelum ini (Campaign URL, kode OTP,
 * blok kode GPT), dengan try/catch, pesan gagal, dan timer "Tersalin" yang sama persis.
 *
 * - **Yang berhasil cuma berganti ikon sebentar, bukan toast**: menyalin beberapa baris
 *   berturut-turut akan menumpuk toast di layar. Pemanggil yang memang ingin toast (OTP, yang
 *   kodenya kedaluwarsa dalam detik) memakai `onCopied`.
 * - **Yang GAGAL tetap bersuara** — diam di sana berarti yang ditempelkan orang adalah isi papan
 *   klip yang lama.
 * - `showLabel` menggambar teks "Salin"/"Tersalin" di sebelah ikon; tanpanya tombolnya ikon saja
 *   dan `label` jadi aria-label + title.
 */
export function CopyButton({
  text,
  label = "Salin",
  showLabel = false,
  className = "ghost-button icon-button",
  disabled = false,
  onCopied,
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      onCopied?.();
    } catch (error) {
      notifyError(error, "Browser ini tidak mengizinkan salin otomatis. Salin manual dari layar.");
    }
  };

  const Icon = copied ? Check : Copy;
  return (
    <button
      aria-label={copied ? "Tersalin" : label}
      className={className}
      disabled={disabled || !text}
      onClick={copy}
      title={copied ? "Tersalin" : label}
      type="button"
    >
      <Icon size={14} />
      {showLabel && (copied ? "Tersalin" : "Salin")}
    </button>
  );
}
