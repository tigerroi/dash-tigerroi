import { Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { groupComplaint, groupEntry, NOTIFICATION_TOPICS } from "../lib/notifications";
import { EmptyPage } from "./EmptyPage";
import { ToggleBox } from "./NotificationCenter";
import { EmptyMessage } from "./ui/EmptyMessage";
import { PageHeader } from "./ui/PageHeader";
import { SelectField, toSelectOptions } from "./ui/SelectField";

/**
 * Tambah/ubah satu chat tujuan yang TIDAK punya baris di Team: grup, channel, atau chat pribadi
 * orang di luar tim.
 *
 * Yang terakhir itu bukan tempelan — tidak semua yang perlu dikabari punya akun dashboard, dan
 * membuatkan akun login berikut role hanya supaya seseorang bisa menerima satu pesan Telegram adalah
 * harga yang jauh lebih besar daripada satu baris di sini. Id chat pribadi bentuknya
 * positif, id grup dan channel negatif; form ini menerima keduanya, dan yang membedakannya di
 * daftar cuma tanda minusnya sendiri.
 *
 * Halaman sendiri, sepola dengan `/targets/new` dan `/otp/new`: yang di tabel adalah daftar tujuan
 * notifikasi yang sedang berlaku, dan sebuah form yang menempel di bawahnya membuat orang menggulir
 * melewatinya tiap kali membuka halaman untuk sekadar memeriksa siapa yang menerima apa.
 *
 * Admin saja — `canManage` di bawah menjaga alamat yang diketik tangan, dan `.write` pada
 * `notificationGroups` di database.rules.json yang benar-benar menolak tulisannya.
 */
export function NotificationContactForm({
  group,
  groups,
  groupId,
  canManage,
  loading,
  pics,
  navigate,
  onSave,
  onRemove,
}) {
  if (!canManage) {
    return (
      <EmptyPage
        description="Grup tujuan notifikasi hanya bisa diubah admin."
        navigate={navigate}
        title="Akses ditolak"
      />
    );
  }

  // Alamat yang menunjuk grup yang sudah dihapus (atau id yang diketik ngawur). Menggambar form
  // kosong di sini berarti tombol Simpan yang menulis ke id yang tidak ada.
  //
  // `loading` diperiksa dulu: daftarnya datang lewat langganan, jadi pada render pertama TIAP id
  // terlihat seperti id yang tidak ada.
  if (groupId && !group) {
    return loading ? (
      <EmptyMessage panel>Memuat...</EmptyMessage>
    ) : (
      <EmptyPage navigate={navigate} />
    );
  }

  return (
    <ContactEditor
      group={group}
      groups={groups}
      navigate={navigate}
      onRemove={onRemove}
      onSave={onSave}
      pics={pics}
    />
  );
}

function ContactEditor({ group, groups, navigate, onSave, onRemove, pics }) {
  const editing = Boolean(group?.id);
  const [form, setForm] = useState(() => ({
    label: group?.label || "",
    chatId: String(group?.chatId ?? ""),
    pic: group?.pic || "",
    enabled: group?.enabled !== false,
    topics: Object.fromEntries(
      NOTIFICATION_TOPICS.map((topic) => [topic.key, group?.topics?.[topic.key] === true]),
    ),
  }));
  const [saving, setSaving] = useState(false);

  const entry = { ...groupEntry(form), enabled: form.enabled };
  // Baris yang sedang disunting tidak diadu dengan dirinya sendiri — kalau tidak, menyimpan tanpa
  // mengubah chat id akan mengeluh "Chat ID ini sudah terdaftar".
  const siblings = (groups || []).filter((row) => row.id !== group?.id);
  const complaint = groupComplaint(entry, siblings);

  const submit = async (event) => {
    event.preventDefault();
    if (complaint) return;

    setSaving(true);
    try {
      if (await onSave(group?.id || null, entry)) navigate("/notifications");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await onRemove(group.id);
      navigate("/notifications");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title={editing ? "Ubah Penerima" : "Tambah Penerima"}
        description="Penerima yang tidak punya baris di Team — orang luar, grup, atau channel."
      />

      <form className="panel form-panel notification-form" onSubmit={submit}>
        {/* Nama sendirian di barisnya, Chat ID dan lingkupnya di bawahnya: yang pertama menjawab
            "ini siapa", dua berikutnya "ke mana dan apa saja" — dan yang dibaca orang saat memeriksa
            baris yang sudah ada selalu dua yang terakhir, berdampingan. */}
        <div className="form-grid">
          <div className="field notification-field-wide">
            <label htmlFor="contact-label">Nama</label>
            <input
              className="control"
              id="contact-label"
              onChange={(event) =>
                setForm((current) => ({ ...current, label: event.target.value }))
              }
              placeholder="Nama penerima"
              value={form.label}
            />
            <small className="muted-line">
              Nama yang tampil di daftar penerima. Bebas — Telegram tidak membacanya.
            </small>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="contact-chat-id">Chat ID</label>
            <input
              className="control"
              id="contact-chat-id"
              inputMode="numeric"
              onChange={(event) =>
                setForm((current) => ({ ...current, chatId: event.target.value }))
              }
              placeholder="-1002223334445"
              value={form.chatId}
            />
            <small className="muted-line">
              Grup dan channel diawali tanda minus; chat pribadi tidak, dan tandanya itulah yang
              menentukan lencana Jenis di daftar. Bot harus sudah menyapa chat itu lebih dulu —
              untuk chat pribadi, orangnya yang mengirim /start.
            </small>
            {/* Keluhannya baru muncul setelah ada yang diketik: form kosong yang langsung berteriak
                "Chat ID belum diisi" menyalahkan orang atas kalimat yang belum selesai ditulisnya. */}
            {(form.label || form.chatId) && complaint && (
              <small className="muted-line form-complaint" role="alert">
                {complaint}
              </small>
            )}
          </div>

          {/* Lingkup Peringatan ROI. Baris di sini tidak punya role dan tidak memegang subdomain
              mana pun, jadi tidak ada yang bisa disimpulkan sendiri — kosong berarti SELURUH armada,
              bukan tidak satu pun: sebuah chat tim yang disaring jadi kosong akan berhenti menerima
              apa pun tanpa ada yang memintanya. Anggota tim tidak punya kotak ini; lingkupnya
              dihitung dari role dan namanya sendiri. */}
          <div className="field">
            <label htmlFor="contact-pic">Lingkup Peringatan ROI</label>
            <SelectField
              id="contact-pic"
              onChange={(pic) => setForm((current) => ({ ...current, pic }))}
              options={[
                { value: "", label: "Semua subdomain" },
                ...toSelectOptions(pics, (pic) => `Subdomain milik ${pic}`),
              ]}
              value={form.pic}
            />
            <small className="muted-line">
              Hanya berlaku untuk topik Peringatan ROI. Pengingat jatuh tempo dan kegagalan sync
              berlaku untuk seluruh usaha, jadi keduanya tidak disaring.
            </small>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <span>Status</span>
            <ToggleBox
              checked={form.enabled}
              id="contact-enabled"
              label="Aktif"
              onChange={(value) => setForm((current) => ({ ...current, enabled: value }))}
            />
            {/* Dinonaktifkan, BUKAN dihapus: chat yang sedang dibisukan sementara (renovasi grup,
                orangnya cuti) tetap membawa seluruh saklar topiknya, jadi menyalakannya lagi tidak
                menuntut siapa pun mengingat apa saja yang dulu ia terima. */}
            <small className="muted-line">
              Nonaktif = berhenti menerima, tapi saklar topiknya di bawah tetap tersimpan.
            </small>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <span>Topik yang diterima</span>
            {NOTIFICATION_TOPICS.map((topic) => (
              <div className="notification-topic-choice" key={topic.key}>
                <ToggleBox
                  checked={form.topics[topic.key] === true}
                  id={`group-topic-${topic.key}`}
                  label={topic.label}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      topics: { ...current.topics, [topic.key]: value },
                    }))
                  }
                />
                <small className="muted-line">{topic.description}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <div className="action-group">
            <button
              className="ghost-button"
              disabled={saving}
              onClick={() => navigate("/notifications")}
              type="button"
            >
              Batal
            </button>
            {editing && (
              <button className="danger-button" disabled={saving} onClick={remove} type="button">
                <Trash2 size={16} /> Hapus
              </button>
            )}
          </div>
          <button className="primary-button" disabled={saving || Boolean(complaint)} type="submit">
            <Save size={16} />
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}
