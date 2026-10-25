import { Save } from "lucide-react";
import { useState } from "react";
import {
  NOTIFICATION_TOPICS,
  topicChoiceUpdate,
  topicSettings,
  userAlertScope,
} from "../lib/notifications";
import { notifySuccess } from "../lib/notify";
import { assignedSubDomains } from "../lib/userSubDomains";
import { EmptyPage } from "./EmptyPage";
import { ToggleBox } from "./NotificationCenter";
import { EmptyMessage } from "./ui/EmptyMessage";
import { PageHeader } from "./ui/PageHeader";

/**
 * Notifikasi SATU orang: chat id-nya, dan saklar tiap topik.
 *
 * Halaman sendiri dan bukan saklar di dalam tabel, sepola dengan seluruh resource di dashboard ini.
 * Tabel yang bisa ditekan langsung memang lebih pendek satu klik, tapi ia menulis ke database tiap
 * kali kursor tergelincir satu baris — dan di daftar setinggi seluruh tim, baris yang salah
 * tersentuh tidak meninggalkan tanda apa pun di layar.
 *
 * ═══ SATU SAKLAR, DUA TANGAN ═══
 *
 * Form ini dibuka admin (untuk siapa saja) MAUPUN orangnya sendiri (untuk dirinya), dan yang
 * ditulisnya node yang sama — bukan dua kolom "ditugaskan admin" dan "diminta sendiri" yang harus
 * diadu dengan aturan siapa-menang. Tiap aturan begitu punya sisi di mana orang menekan saklar lalu
 * tidak terjadi apa-apa, dan saklar yang tidak melakukan apa-apa adalah kerusakan yang tidak
 * berbunyi. Siapa yang menekan terakhir tercatat di Activity Logs.
 *
 * Izinnya dijaga DUA kali dan keduanya perlu: gerbang di bawah (supaya alamat yang diketik tangan
 * tidak membuka baris orang lain) dan aturan `users/$uid/notificationTopics` di database.rules.json,
 * yang benar-benar menolak tulisannya.
 */
export function NotificationPersonForm({
  row,
  canManage,
  isOwn,
  loading,
  settings,
  subDomains,
  navigate,
  onSaveTopics,
  onSaveChatId,
}) {
  // Daftar user datang lewat langganan, jadi baris yang dicari BELUM ADA pada render pertama.
  // Menggambar "tidak ditemukan" di sana adalah kedipan yang terbaca persis seperti tautan yang
  // rusak — dan orang menekan Back sebelum barisnya sempat datang.
  if (!row && loading) {
    return <EmptyMessage panel>Memuat...</EmptyMessage>;
  }

  if (!row) {
    return <EmptyPage navigate={navigate} />;
  }

  if (!canManage && !isOwn) {
    return (
      <EmptyPage
        description="Notifikasi orang lain hanya bisa diubah admin. Barisnya sendiri ada di /notifications."
        navigate={navigate}
        title="Akses ditolak"
      />
    );
  }

  return (
    <PersonEditor
      navigate={navigate}
      onSaveChatId={onSaveChatId}
      onSaveTopics={onSaveTopics}
      row={row}
      settings={settings}
      subDomains={subDomains}
    />
  );
}

function PersonEditor({ row, settings, subDomains, navigate, onSaveTopics, onSaveChatId }) {
  const storedChatId = String(row.telegramChatId ?? "");
  const storedTopics = row.notificationTopics || {};
  const [chatId, setChatId] = useState(storedChatId);
  const [topics, setTopics] = useState(storedTopics);
  const [saving, setSaving] = useState(false);

  const complaint =
    chatId.trim() && !/^-?\d{1,20}$/.test(chatId.trim())
      ? "Chat ID harus berupa angka — id chat pribadi tidak diawali tanda minus."
      : "";

  const submit = async (event) => {
    event.preventDefault();
    if (complaint) return;

    setSaving(true);
    try {
      // Chat id DULU, saklarnya sesudahnya. Dibalik, saklar yang tersimpan untuk baris yang chat
      // id-nya gagal ditulis adalah langganan tanpa alamat: ia tidak menerima apa pun, dan tabelnya
      // tetap menggambarnya sebagai orang yang berlangganan.
      if (chatId.trim() !== storedChatId) {
        // Berhenti kalau chat id-nya ditolak: saklar yang tersimpan di atas alamat yang gagal
        // ditulis adalah langganan tanpa tujuan, dan tabelnya tetap menggambarnya berlangganan.
        if (!(await onSaveChatId(row.id, chatId.trim()))) return;
      }
      if (await onSaveTopics(row.id, normalizeTopics(topics))) {
        notifySuccess("Notifikasi tersimpan.");
        navigate("/notifications");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title={row.name || row.username || row.email || "Notifikasi"}
        description="Chat Telegram dan topik yang diterima orang ini."
      />

      <form className="panel form-panel notification-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="person-chat-id">Chat ID Telegram</label>
            <input
              className="control"
              id="person-chat-id"
              inputMode="numeric"
              onChange={(event) => setChatId(event.target.value)}
              placeholder="123456789"
              value={chatId}
            />
            <small className="muted-line">
              Kosong = tidak dikirimi apa pun, berapa pun saklar yang menyala di bawah.
            </small>
            {complaint && (
              <small className="muted-line form-complaint" role="alert">
                {complaint}
              </small>
            )}
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <span>Topik yang diterima</span>
            {NOTIFICATION_TOPICS.map((topic) => {
              const choice = topics[topic.key];
              // Yang ikut lewat siaran role memang MENERIMA topik itu, dan kotak yang tidak
              // tercentang untuknya adalah kebohongan yang paling mudah dipercaya di halaman ini.
              // Mencentangnya menuliskan pilihan tetap; melepasnya menuliskan `false`, yang
              // mengalahkan siaran (lihat `topicChoiceUpdate`).
              const bySiaran =
                choice === undefined &&
                topicSettings(settings, topic.key).roles.some((role) =>
                  String(row.role || "user")
                    .toLowerCase()
                    .split(",")
                    .map((part) => part.trim())
                    .includes(role),
                );

              return (
                <div className="notification-topic-choice" key={topic.key}>
                  <ToggleBox
                    checked={choice === true || bySiaran}
                    id={`person-topic-${topic.key}`}
                    label={topic.label}
                    onChange={(value) =>
                      setTopics((current) => topicChoiceUpdate(current, topic.key, value))
                    }
                  />
                  <small className="muted-line">
                    {topic.description}
                    {bySiaran ? " Sedang ikut karena role-nya disiarkan di tab Topik." : ""}
                    {/* Lingkupnya disebutkan DI SINI, di sebelah saklarnya, dan bukan sebagai
                        keterangan halaman: pertanyaan "kenapa saya tidak menerima apa-apa" muncul
                        justru pada orang yang saklarnya sudah menyala, dan jawabannya (bukan admin,
                        belum memegang subdomain mana pun) tidak ada di tempat lain mana pun. */}
                    {topic.key === "roiAlerts" && ` ${alertScopeNote(row, subDomains)}`}
                  </small>
                </div>
              );
            })}
          </div>
        </div>

        <div className="form-actions">
          <button
            className="ghost-button"
            disabled={saving}
            onClick={() => navigate("/notifications")}
            type="button"
          >
            Batal
          </button>
          <button className="primary-button" disabled={saving || Boolean(complaint)} type="submit">
            <Save size={16} />
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Kalimat yang menjelaskan baris ROI mana yang akan sampai ke orang ini.
 *
 * Admin menerima seluruh armada; sisanya menerima subdomain yang PIC-nya dirinya sendiri
 * (`userAlertScope`, cerminan functions/notifications-core.js). Jumlah subdomainnya ikut disebut
 * karena nol adalah jawaban yang paling sering dicari: saklar menyala, chat id terisi, dan tetap
 * tidak ada yang datang.
 */
function alertScopeNote(row, subDomains) {
  const scope = userAlertScope(row);
  if (scope.all) return "Menerima seluruh subdomain (admin).";

  const held = assignedSubDomains(row, subDomains).length;
  if (held === 0) {
    return `Hanya subdomain yang PIC-nya ${scope.label || "orang ini"} — belum ada satu pun, jadi belum ada yang akan dikirim.`;
  }
  return `Hanya subdomain yang PIC-nya ${scope.label} (${held} subdomain).`;
}

/**
 * Peta saklar yang siap ditulis: hanya topik yang benar-benar dipilih, `false` ikut tersimpan.
 *
 * `topicChoiceUpdate` sudah membersihkannya tiap kali sebuah kotak ditekan, tapi baris yang TIDAK
 * disentuh sama sekali di form ini tetap membawa isi lamanya apa adanya — termasuk kunci topik yang
 * sudah dihapus dari registry, yang akan ditolak `.validate` di database.rules.json dan menjatuhkan
 * seluruh simpanan.
 */
function normalizeTopics(topics) {
  return NOTIFICATION_TOPICS.reduce((out, topic) => {
    const choice = topics?.[topic.key];
    if (choice === true || choice === false) out[topic.key] = choice;
    return out;
  }, {});
}
