import { KeyRound, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useSyncRuns } from "../hooks/useSyncRuns";
import { useUrlState } from "../hooks/useUrlState";
import { adTaxRateOf, DEFAULT_AD_TAX_PERCENT, formatAdTaxPercent } from "../lib/adTax";
import { CONTROL_API_ENABLED, runSyncStageNow } from "../lib/controlApi";
import { notifySuccess, notifyWarning } from "../lib/notify";
import { MIN_PASSWORD_LENGTH, validatePasswordChange } from "../lib/passwordChange";
import { PageHeader } from "./ui/PageHeader";
import { SyncLogPanel } from "./ui/SyncLogPanel";
import { TabStrip } from "./ui/TabStrip";

// Tiga hal yang tidak saling berhubungan: tarif pajak, password sendiri, dan riwayat sync.
// Ditumpuk dalam satu kolom, yang dicari orang selalu ada di bawah panel-panel yang tidak sedang
// dibukanya.
//
// DUA TAB PINDAH KE NOTIFICATION CENTER, dan keduanya karena alasan yang sama.
//
// "Telegram" — satu kotak berisi semua chat id, dipisah koma — bukan salah tempatnya melainkan
// salah bentuknya: satu daftar tujuan berarti tiap orang di dalamnya menerima segalanya, dan
// berhenti menerima satu jenis pesan hanya bisa dengan berhenti menerima semuanya.
//
// "Peringatan" (ambang ROI) menjawab "berapa ambangnya", sementara halaman Notification Center
// menjawab "siapa yang dikabari" — dan satu-satunya pertanyaan yang benar-benar ditanyakan orang
// adalah keduanya sekaligus. Selama keduanya berjauhan, ambang yang menyala tanpa penerima (dan
// sebaliknya) adalah keadaan yang tidak terlihat di layar mana pun.
//
// Alamat lama keduanya dialihkan di main.jsx (`SETTINGS_TABS_MOVED`), bukan dibiarkan membuka
// halaman ini dengan tab yang tidak dikenali siapa pun.
const TABS = [
  ["ad-tax", "Ad Tax"],
  ["password", "Change Password"],
  ["logs", "Logs"],
];

// Pengaturan yang mengubah arti angka di seluruh dashboard, jadi tempatnya satu halaman sendiri
// dan bukan env: tarif pajak berubah karena keputusan, bukan karena deploy.
export function SettingsPage({ settings, onSave, readOnly = false, syncStatus, onChangePassword }) {
  const [tab, setTab] = useUrlState("tab", TABS[0][0]);
  // Log sync tinggal di SQLite server sekarang; diminta saat halaman dibuka, bukan lewat store.
  const {
    runs: syncRuns,
    loading: syncRunsLoading,
    error: syncRunsError,
  } = useSyncRuns(Boolean(syncStatus?.running));

  // Satu tahap sync sekarang juga, lewat server kontrol (admin). Hasilnya bukan jawaban tombol ini
  // melainkan baris log yang muncul begitu run-nya selesai.
  const runStage = async (stage) => {
    try {
      await runSyncStageNow(stage);
      notifySuccess(`${stage} berjalan — hasilnya muncul di log ini begitu selesai.`);
    } catch (error) {
      notifyWarning(error.message);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        description="Pengaturan yang dipakai seluruh perhitungan ROI di dashboard."
      />

      <TabStrip
        active={tab}
        label="Bagian Settings"
        onChange={setTab}
        tabs={TABS.map(([id, label]) => ({
          id,
          label,
          tabId: `settings-tab-${id}`,
          panelId: `settings-panel-${id}`,
        }))}
      />

      <div aria-labelledby={`settings-tab-${tab}`} id={`settings-panel-${tab}`} role="tabpanel">
        {/* Hanya panel yang terpilih yang dirender. Semuanya sekaligus berarti menu di atas cuma
            menggulirkan halaman, dan itu bukan yang dijanjikan sebuah tab. */}
        {tab === "ad-tax" && <AdTaxPanel readOnly={readOnly} settings={settings} onSave={onSave} />}
        {/* `readOnly` sengaja TIDAK diteruskan: ia menjawab "boleh mengubah pengaturan dashboard?"
            (canEditSettings — admin saja), dan password sendiri bukan pengaturan dashboard. Seorang
            advertiser yang tidak boleh menyentuh tarif ad tax tetap harus bisa mengganti password
            akunnya sendiri; kalau tidak, satu-satunya jalan adalah meminta admin. */}
        {tab === "password" && <PasswordPanel onSubmit={onChangePassword} />}
        {tab === "logs" && (
          <SyncLogPanel
            runs={syncRuns}
            status={syncStatus}
            loading={syncRunsLoading}
            error={syncRunsError}
            onRunStage={!readOnly && CONTROL_API_ENABLED ? runStage : undefined}
          />
        )}
      </div>
    </div>
  );
}

function AdTaxPanel({ settings, onSave, readOnly }) {
  const stored = settings?.adTaxPercent;
  const [percent, setPercent] = useState(() => toInputValue(stored));
  const [saving, setSaving] = useState(false);
  // Nilai dari database datang belakangan (dan bisa berubah dari tab lain). Tanpa ini form-nya
  // menampilkan angka default seumur hidup halaman, dan menyimpannya akan menimpa tarif asli.
  useEffect(() => {
    setPercent(toInputValue(stored));
  }, [stored]);

  const parsed = Number(percent);
  const valid = percent !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;

  const submit = async (event) => {
    event.preventDefault();
    if (!valid) {
      return;
    }

    setSaving(true);
    try {
      await onSave({ adTaxPercent: parsed });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-header">
        <div>
          <h2>Ad Tax</h2>
          <p>
            Pajak iklan yang ditagih di atas Meta spend. Dipakai tabel Laporan ROI Realtime, Report
            Master, dan ROI per Negara.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="ad-tax-percent">Ad Tax (%)</label>
          <input
            id="ad-tax-percent"
            className="control"
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            disabled={readOnly}
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
          />
          <small className="muted-line">
            {stored === undefined || stored === null || stored === ""
              ? `Belum diatur — perhitungan memakai ${DEFAULT_AD_TAX_PERCENT}%.`
              : `Tersimpan: ${formatAdTaxPercent(adTaxRateOf(settings))}.`}
          </small>
        </div>
      </div>

      {!readOnly && (
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving || !valid}>
            <Save size={16} />
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      )}
    </form>
  );
}

// Ganti password akun yang sedang login — bukan password orang lain. Yang mengganti password
// akun lain adalah form Team (admin), dan menggabungkan keduanya di satu layar berarti satu salah
// klik memindahkan password ke akun yang salah.
function PasswordPanel({ onSubmit }) {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  // Keluhan baru ditampilkan setelah tombolnya ditekan sekali. Sebuah form yang berteriak
  // "konfirmasi belum sama" pada huruf pertama yang diketik di kotak konfirmasi menyalahkan orang
  // atas kalimat yang belum selesai ditulisnya.
  const [touched, setTouched] = useState(false);
  const complaint = validatePasswordChange(form);

  const set = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (complaint) {
      return;
    }

    setSaving(true);
    try {
      // Kotaknya baru dikosongkan kalau servernya benar-benar menerima. Password lama yang hilang
      // dari layar setelah ditolak berarti mengetik ulang semuanya untuk satu huruf yang keliru.
      const ok = await onSubmit(form);
      if (ok) {
        setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setTouched(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-header">
        <div>
          <h2>Change Password</h2>
          <p>
            Mengganti password akun yang sedang login. Sesi di perangkat lain tetap terbuka sampai
            keluar sendiri.
          </p>
        </div>
      </div>

      {/* Satu kolom, bukan dua. Ketiga kotaknya dibaca berurutan — lama, baru, ulangi — dan dua
          kolom memecah urutan itu jadi bentuk Z yang menaruh "Ulangi Password Baru" di bawah
          "Password Lama". Ia juga yang membuat kotak Password Lama lebih tinggi dari tetangganya:
          di satu baris grid, field yang punya baris bantuan ("Minimal N karakter") meregangkan
          seluruh barisnya, dan kotak di sebelahnya ikut memanjang tanpa alasan. */}
      <div className="form-grid single-column">
        <div className="field">
          <label htmlFor="current-password">Password Lama</label>
          <input
            id="current-password"
            className="control"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={set("currentPassword")}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">Password Baru</label>
          <input
            id="new-password"
            className="control"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={set("newPassword")}
          />
          <small className="muted-line">Minimal {MIN_PASSWORD_LENGTH} karakter.</small>
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Ulangi Password Baru</label>
          <input
            id="confirm-password"
            className="control"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={set("confirmPassword")}
          />
        </div>
      </div>

      {touched && complaint && (
        <p className="muted-line form-complaint" role="alert">
          {complaint}
        </p>
      )}

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          <KeyRound size={16} />
          {saving ? "Menyimpan..." : "Ubah Password"}
        </button>
      </div>
    </form>
  );
}

function toInputValue(value) {
  return value === undefined || value === null || value === ""
    ? String(DEFAULT_AD_TAX_PERCENT)
    : String(value);
}
