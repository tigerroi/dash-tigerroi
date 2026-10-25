import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { createGuardrails, generateSync } from "otplib";
import { useEffect, useMemo, useState } from "react";
import { notifySuccess } from "../lib/notify";
import { DEFAULT_OTP, formatCode, secondsRemaining, timeStepOf } from "../lib/otp";
import { CopyButton } from "./ui/CopyButton";
import { DataTable } from "./ui/DataTable";
import { Dialog } from "./ui/Dialog";
import { PageHeader } from "./ui/PageHeader";

// otplib v13 menolak secret di bawah 16 byte (anjuran RFC 4226), dan hampir semua secret yang
// benar-benar dibagikan Google, Meta, dan Keitaro adalah 16 KARAKTER Base32 — 10 byte. Guardrail
// bawaannya akan membuat halaman ini gagal untuk akun yang paling sering dibuka, jadi batasnya
// diturunkan ke 10 byte: batas yang sama dengan yang diterima aplikasi authenticator di ponsel.
const GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES: 10 });

// Jam dinding halaman ini. Setengah detik, bukan satu: dengan satu detik, hitungan mundur yang
// jatuh tepat di sela detak terlihat melompati angka.
const TICK_MS = 500;

// Lima detik terakhir. Di bawah ini kodenya sudah tidak layak diketik ke jendela lain — tabel
// menandainya merah supaya orang menunggu yang berikutnya alih-alih mengetik yang kedaluwarsa.
const EXPIRING_SECONDS = 5;

/**
 * Daftar akun yang 2FA-nya dipegang bersama, dengan kode enam angkanya di kolom tabel.
 *
 * Superadmin saja (`SUPERADMIN_PAGES` + `.read` superadmin pada `otpSecrets`), dan itu bukan
 * pengetatan berlebihan: secret TOTP adalah setengah dari kunci sebuah akun — yang membacanya bisa
 * masuk ke Ads Manager atau Ad Manager atas nama siapa pun yang secret-nya tersimpan di sini.
 *
 * Kodenya dihitung di browser, tidak pernah disimpan, dan tidak pernah lewat server mana pun. Yang
 * tersimpan di RTDB hanya secret-nya (`otpSecrets`, superadmin di kedua arah) — sebuah kode yang
 * ikut tersimpan adalah kode yang masih terbaca lama setelah ia kedaluwarsa.
 */
export function OtpPage({ items = [], onAdd, onDelete }) {
  const [now, setNow] = useState(() => Date.now());
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Satu jam untuk seluruh tabel: kode dan hitungan mundur tiap baris dihitung dari `now` milik
  // halaman, bukan dari jam masing-masing baris, jadi semua baris berganti bersamaan.
  const rows = useMemo(() => items.map((item) => otpRow(item, now)), [items, now]);

  return (
    <div className="page-stack">
      <PageHeader
        title="OTP"
        description="Kode dua faktor akun yang dipegang bersama. Kodenya berganti sendiri tiap kali hitungan mundurnya habis."
        action={
          <button className="primary-button" onClick={onAdd} type="button">
            <Plus size={14} />
            Tambah
          </button>
        }
      />

      {/* Tanpa panel-header: judulnya sudah tertulis di PageHeader beberapa piksel di atas, dan
          "Daftar OTP" di bawah "OTP" cuma mendorong tabelnya turun untuk mengulang kalimat yang
          sama. */}
      <div className="panel">
        <DataTable
          className="otp-table"
          columns={OTP_COLUMNS}
          emptyText="Belum ada OTP tersimpan."
          extraAction={(row) => <OtpActions onDelete={setPendingDelete} row={row} />}
          items={rows}
        />
      </div>

      {pendingDelete && (
        <Dialog
          onClose={() => setPendingDelete(null)}
          subtitle={`"${pendingDelete.name}" tidak akan tampil lagi di sini. Secret-nya tetap ada di akun aslinya — yang hilang cuma jalan pintas ini.`}
          title="Arsipkan OTP?"
        >
          <div className="confirm-actions">
            <button className="ghost-button" onClick={() => setPendingDelete(null)} type="button">
              Batal
            </button>
            <button
              className="danger-button"
              onClick={async () => {
                await onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
              type="button"
            >
              <Trash2 size={14} />
              Arsipkan
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Satu baris = satu akun. Kode dan hitungan mundurnya dihitung dari `now` milik halaman, bukan dari
 * jam masing-masing baris: satu interval untuk seluruh tabel, dan semua baris berganti bersamaan.
 */
function otpRow(item, now) {
  const period = item.period || DEFAULT_OTP.period;
  const digits = item.digits || DEFAULT_OTP.digits;
  const algorithm = item.algorithm || DEFAULT_OTP.algorithm;
  const remaining = secondsRemaining(now, period);
  const step = timeStepOf(now, period);

  return {
    ...item,
    period,
    digits,
    algorithm,
    remaining,
    expiring: remaining <= EXPIRING_SECONDS,
    code: otpCode(item.secret, digits, period, algorithm, step),
  };
}

// Dihitung ulang saat LANGKAH-nya berganti, bukan tiap detak; epoch-nya diturunkan dari step
// (bukan dari `now`) supaya kode yang tampil selalu kode milik langkah itu, termasuk di detak
// terakhir sebelum pergantian. Cermin kecil ini yang menggantikan `useMemo` per baris: detak
// setengah detik tidak boleh menghitung HMAC ulang untuk langkah yang sama.
const codeCache = new Map();

function otpCode(secret, digits, period, algorithm, step) {
  const cacheKey = `${secret}|${digits}|${period}|${algorithm}|${step}`;

  if (codeCache.has(cacheKey)) {
    return codeCache.get(cacheKey);
  }

  let code;
  try {
    code = generateSync({
      secret,
      digits,
      period,
      algorithm,
      epoch: step * period,
      guardrails: GUARDRAILS,
    });
  } catch {
    // Baris yang secret-nya tidak bisa dipakai tidak boleh menjatuhkan seluruh tabel — dan
    // "-" adalah tanda yang sama dengan yang dipakai kolom lain untuk yang tidak diketahui.
    code = "";
  }

  // Yang tersimpan cuma langkah yang sedang berjalan; langkah lama tidak akan diminta lagi.
  if (codeCache.size > 200) {
    codeCache.clear();
  }
  codeCache.set(cacheKey, code);
  return code;
}

// Hanya Nama yang bisa diurutkan: kode berganti tiap langkah waktu, jadi urutan menurut kode
// atau sisa detik akan mengocok baris sendiri tiap setengah menit.
const OTP_COLUMNS = [
  {
    accessorKey: "name",
    header: "Nama",
    cell: ({ row }) => {
      const { name, digits, period, algorithm } = row.original;
      return (
        <>
          <div className="otp-name">{name}</div>
          {/* Yang bukan 6 digit / 30 detik / SHA-1 disebutkan, sisanya tidak: keterangan yang
              menempel di setiap baris berhenti menandai apa pun. */}
          {(digits !== DEFAULT_OTP.digits ||
            period !== DEFAULT_OTP.period ||
            algorithm !== DEFAULT_OTP.algorithm) && (
            <div className="muted-line">
              {digits} digit · {period}s · {algorithm.toUpperCase()}
            </div>
          )}
        </>
      );
    },
  },
  {
    id: "secret",
    header: "Secret",
    enableSorting: false,
    cell: ({ row }) => <OtpSecret secret={row.original.secret} />,
  },
  {
    id: "code",
    header: "Kode",
    enableSorting: false,
    cell: ({ row }) => (
      <span className={row.original.expiring ? "otp-code otp-code-expiring" : "otp-code"}>
        {row.original.code ? formatCode(row.original.code) : "-"}
      </span>
    ),
  },
  {
    id: "remaining",
    header: "Sisa",
    enableSorting: false,
    cell: ({ row }) => {
      const { code, expiring, remaining, period } = row.original;

      if (!code) {
        return <span className="muted-cell">Secret tidak terbaca</span>;
      }

      return (
        <div className="otp-countdown">
          <div className="otp-countdown-bar">
            <div
              className={expiring ? "otp-countdown-fill expiring" : "otp-countdown-fill"}
              style={{ width: `${Math.max(0, Math.min(100, (remaining / period) * 100))}%` }}
            />
          </div>
          <span className="otp-countdown-seconds">{remaining}s</span>
        </div>
      );
    },
  },
];

// Keadaan tampil/sembunyi milik SEL-nya sendiri: tiap baris membuka secret-nya sendiri-sendiri.
function OtpSecret({ secret }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="secret-cell">
      <span className={revealed ? "otp-secret-text" : "secret"}>
        {revealed ? secret : "••••••••"}
      </span>
      <button
        aria-label={revealed ? "Sembunyikan secret" : "Tampilkan secret"}
        className="secret-toggle-button"
        onClick={() => setRevealed((value) => !value)}
        type="button"
      >
        {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

function OtpActions({ row, onDelete }) {
  return (
    <div className="action-group">
      <CopyButton
        className="ghost-button"
        label={`Salin kode ${row.name}`}
        onCopied={() => notifySuccess(`Kode ${row.name} disalin.`)}
        showLabel
        text={row.code}
      />
      <button className="danger-button" onClick={() => onDelete(row)} type="button">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
