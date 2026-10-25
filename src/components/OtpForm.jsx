import { Eye, EyeOff, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_OTP, parseOtpInput } from "../lib/otp";
import { PageHeader } from "./ui/PageHeader";

/**
 * Halaman tambah OTP — berdiri sendiri, dituju dari tombol "Tambah" di /otp.
 *
 * Satu masukan untuk dua bentuk yang beredar — secret Base32 telanjang dan URI `otpauth://` utuh —
 * karena yang menempel keduanya adalah orang yang sama, dari layar yang sama.
 *
 * Tidak mengimpor otplib sama sekali, dan itu bukan kebetulan: halaman ini tidak pernah menghitung
 * satu kode pun. Yang dibutuhkannya cuma `parseOtpInput`, yang murni.
 */
export function OtpForm({ onSave, onCancel }) {
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => parseOtpInput(input), [input]);

  // Google Authenticator dan Meta sama-sama TOTP baku: SHA-1, 6 digit, 30 detik — Google
  // Authenticator bahkan MENGABAIKAN parameter lain di URI dan selalu memakai ketiganya. Jadi tidak
  // ada yang perlu dipilih di form ini; nilainya diambil dari URI kalau URI-nya menyebut lain
  // (penerbit 8 digit ada, dan enam angka untuknya akan ditolak tanpa satu pun pesan yang menyebut
  // sebabnya), dan dari `DEFAULT_OTP` untuk semua yang lain.
  const options = {
    digits: parsed.digits,
    period: parsed.period,
    algorithm: parsed.algorithm,
  };
  const nonStandard =
    options.digits !== DEFAULT_OTP.digits ||
    options.period !== DEFAULT_OTP.period ||
    options.algorithm !== DEFAULT_OTP.algorithm;

  // Nama dari URI hanya sebagai USULAN, dan hanya selama kotaknya masih kosong: menimpa nama yang
  // sudah diketik orang dengan label dari URI adalah kehilangan yang tidak ada tombol undo-nya.
  const suggestedName = [parsed.issuer, parsed.label].filter(Boolean).join(" · ");
  useEffect(() => {
    if (suggestedName) setName((current) => current || suggestedName);
  }, [suggestedName]);

  const ready = Boolean(name.trim() && parsed.secret && !parsed.error);

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;

    setSaving(true);
    try {
      const saved = await onSave({
        name: name.trim(),
        secret: parsed.secret,
        ...options,
        ...(parsed.issuer ? { issuer: parsed.issuer } : {}),
      });
      // Kembali ke daftarnya hanya kalau tulisannya mendarat. Gagal, form-nya ditinggalkan utuh —
      // secret yang sudah ditempel dan hilang karena navigasi adalah secret yang harus dicari ulang
      // dari layar aslinya.
      if (saved) {
        onCancel();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Tambah OTP"
        description="Simpan nama akun dan secret key-nya. Kodenya langsung muncul di daftar OTP."
      />

      <form className="panel form-panel" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="otp-name">Nama</label>
            <input
              autoComplete="off"
              className="control"
              id="otp-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>

          <div className="field otp-secret-field">
            <label htmlFor="otp-secret">Secret atau URI otpauth</label>
            <div className="otp-secret-input">
              <input
                autoComplete="off"
                className="control"
                id="otp-secret"
                onChange={(event) => setInput(event.target.value)}
                placeholder="Tempel secret Base32 atau otpauth://…"
                spellCheck={false}
                type={revealed ? "text" : "password"}
                value={input}
              />
              <button
                aria-label={revealed ? "Sembunyikan secret" : "Tampilkan secret"}
                className="ghost-button"
                onClick={() => setRevealed((value) => !value)}
                type="button"
              >
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Yang tidak baku disebutkan, yang baku tidak. Sebuah keterangan yang muncul di setiap
            penambahan berhenti menandai apa pun — dan yang perlu diketahui orang di sini justru
            kejadian langka: URI yang meminta bentuk selain 6 digit / 30 detik / SHA-1. */}
        {nonStandard && !parsed.error && (
          <p className="notice-line">
            URI ini memakai {options.digits} digit · {options.period} detik ·{" "}
            {options.algorithm.toUpperCase()}, bukan bentuk baku 6 digit · 30 detik · SHA-1. Ikut
            disimpan apa adanya.
          </p>
        )}

        {parsed.error && <p className="form-complaint">{parsed.error}</p>}

        <div className="form-actions">
          <button className="ghost-button" disabled={saving} onClick={onCancel} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={!ready || saving} type="submit">
            <Plus size={14} />
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}
