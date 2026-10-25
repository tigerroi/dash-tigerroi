import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { BROADCAST_ROLES } from "../config/access";
import { DEFAULT_ALERTS } from "../lib/alerts";
import { formatDateTime } from "../lib/formatDate";
import {
  isGroupChat,
  joinRoleList,
  NOTIFICATION_TOPICS,
  topicRecipients,
  topicSettings,
} from "../lib/notifications";
import { pendingChats } from "../lib/telegramInbox";
import { DataTable } from "./ui/DataTable";
import { EmptyMessage } from "./ui/EmptyMessage";
import { PageHeader } from "./ui/PageHeader";
import { Switch } from "./ui/Switch";

/**
 * Notification Center — siapa menerima notifikasi apa.
 *
 * Menggantikan `/settings?tab=telegram`, yang isinya SATU kotak teks berisi semua chat id dipisah
 * koma. Yang salah dengan kotak itu bukan bentuknya melainkan akibatnya: tiap id di dalamnya
 * menerima segalanya, dan satu-satunya cara berhenti menerima satu jenis pesan adalah dihapus dari
 * daftar — yang juga menghentikan jenis yang lain. Notifikasi yang tidak bisa disaring akan
 * dibisukan orang, dan yang ikut terbisukan adalah yang benar-benar penting.
 *
 * ═══ HALAMAN INI TERBUKA UNTUK SEMUA ROLE, DAN ITU INTINYA ═══
 *
 * Saklar "saya mau menerima apa" tidak berarti apa-apa kalau yang bisa membukanya cuma admin. Yang
 * dijaga `canManage` (admin) hanya bagian yang menyangkut orang lain: setelan tiap topik, siaran per
 * role, daftar grup, ambang peringatan, dan baris milik anggota tim yang lain. Tiap orang selalu
 * boleh mengubah barisnya sendiri — dan aturan `users/$uid/notificationTopics` di
 * database.rules.json yang benar-benar menegakkannya, dicocokkan lewat email persis seperti saklar
 * campaign.
 *
 * ═══ EMPAT TAB, DAN SEMUANYA ROUTE SUNGGUHAN ═══
 *
 * Sepola dengan Overview dan tab lain di dashboard ini (lihat CLAUDE.md): `/notifications` (Orang),
 * `/notifications/topik`, `/notifications/calon`, `/notifications/peringatan`. Bukan panel yang
 * berganti isi tanpa pindah alamat — halaman tambah/sunting di bawahnya
 * (`/notifications/kontak/new`) dan tombol Back bekerja persis seperti halaman lain.
 *
 * Calon Penerima adalah satu-satunya yang tertutup untuk selain admin (`key: "telegramInbox"`),
 * karena yang ditampilkannya bukan setelan kita melainkan nama profil orang luar yang menyapa bot
 * publik kita.
 *
 * Tab pertamanya "Orang" dan bukan "Topik", karena itulah yang dicari mayoritas yang membukanya:
 * seorang PIC datang ke sini untuk barisnya sendiri, bukan untuk setelan yang tidak boleh ia sentuh.
 *
 * Grup TIDAK punya tab sendiri, dan itu keputusan: pertanyaan yang dibawa orang ke halaman ini
 * adalah "siapa saja yang dikirimi", satu pertanyaan — dan jawabannya yang dipecah dua daftar
 * menuntut orang membuka dua tempat untuk tahu kenapa sebuah pesan tidak sampai. Baris grup berdiri
 * di daftar yang sama, dibedakan oleh lencana Jenis yang dibaca dari tanda id-nya sendiri.
 */
export function NotificationCenter({
  store,
  viewer,
  canManage,
  tab = "orang",
  navigate,
  alerts,
  onSaveAlerts,
  onSaveSettings,
  onActivateChat,
  onDismissChat,
}) {
  const users = store.users || [];
  const groups = store.notificationGroups || [];
  const settings = store.notificationSettings || {};
  const ownRow = ownUserRow(users, viewer);

  return (
    <div className="page-stack">
      <PageHeader
        title="Notification Center"
        description="Siapa menerima notifikasi Telegram apa — per orang, per grup, atau per role."
        action={
          canManage && tab === "orang" ? (
            <button
              className="primary-button"
              onClick={() => navigate("/notifications/kontak/new")}
              type="button"
            >
              <Plus size={16} /> Tambah Penerima
            </button>
          ) : null
        }
      />

      {/* Tab-nya sendiri, dan sempat berdiri sebagai panel di atas daftar Orang. Yang memindahkannya
          bukan kerapian melainkan isinya: ini ANTREAN — kosong hampir sepanjang waktu, habis begitu
          dikerjakan — sementara daftar Orang adalah keadaan yang dibaca terus. Panel kosong tepat di
          atas tabel yang justru dicari orang cuma mendorong tabel itu turun tiap kali halaman
          dibuka.

          Panel di atas daftar Orang terlihat tanpa diklik dan tab tidak, jadi yang menggantikan
          sinyal itu adalah LENCANA ANGKA di kepala tab (`tabBadgesOf` di main.jsx) — tanpa itu,
          pemindahan ini menukar panel yang mengganggu dengan antrean yang tidak pernah dilihat
          siapa pun. Yang masih tersisa sebagai batas: lencananya baru terbaca setelah halaman
          Notifikasi dibuka, bukan dari sidebar.

          `canManage` tetap diperiksa di sini walau route-nya sudah ber-key `telegramInbox`: alamat
          yang diketik tangan berhenti di gerbang izin App, tapi prop ini yang menahan tombolnya
          kalau suatu hari tab-nya dibuka dari tempat lain. */}
      {tab === "calon" && canManage && (
        <DetectedPanel
          groups={groups}
          inbox={store.telegramInbox}
          onActivate={onActivateChat}
          onDismiss={onDismissChat}
          users={users}
        />
      )}
      {tab === "orang" && (
        <PeoplePanel
          canManage={canManage}
          contacts={groups}
          navigate={navigate}
          ownId={ownRow?.id}
          settings={settings}
          users={users}
        />
      )}
      {tab === "topik" && (
        <TopicPanel
          canManage={canManage}
          groups={groups}
          settings={settings}
          users={users}
          onSave={onSaveSettings}
        />
      )}
      {tab === "peringatan" && (
        <AlertPanel readOnly={!canManage} settings={alerts} onSave={onSaveAlerts} />
      )}
    </div>
  );
}

/**
 * Baris `users` milik yang sedang melihat, dicocokkan lewat EMAIL.
 *
 * `/users` dikunci push key, jadi email adalah satu-satunya tali antara akun yang login dan baris
 * profilnya — alasan yang sama persis dengan `canToggleCampaign` dan dengan aturan
 * `users/$uid/notificationTopics` di database.rules.json. Diekspor karena halaman sunting orang
 * memakainya untuk pertanyaan yang sama: baris ini milik yang membukanya atau bukan.
 */
export function ownUserRow(users, viewer) {
  const email = String(viewer?.email || "")
    .trim()
    .toLowerCase();
  if (!email) return undefined;

  return (users || []).find(
    (row) =>
      String(row.email || "")
        .trim()
        .toLowerCase() === email,
  );
}

/**
 * Chat yang menyapa bot dan belum jadi penerima — TAWARAN, bukan daftar tujuan.
 *
 * Yang digantikan panel ini adalah satu-satunya langkah manual yang tersisa di halaman ini:
 * orangnya kirim /start, seseorang membuka terminal untuk `npm run telegram:chat-id`, menyalin
 * angka 10 digit dari layar, dan mengetiknya kembali di form Tambah Penerima. Langkah ketiga itu
 * satu-satunya di seluruh dashboard yang salah ketiknya TIDAK mengeluh di mana pun — chat id yang
 * meleset satu digit tetap berbentuk angka, lolos `groupComplaint`, tersimpan rapi, dan gagal
 * diam-diam tiap kali dikirimi. Di sini tidak ada yang diketik sama sekali.
 *
 * ═══ SATU KLIK, DAN KLIK ITU TIDAK BOLEH DIHAPUS ═══
 *
 * @rabbitroi_bot bot PUBLIK: siapa pun yang tahu namanya bisa mengirim /start, dan tidak ada cara
 * memberi tahu Telegram bahwa hanya orang tertentu yang boleh. Baris di sini karena itu berhenti
 * sebagai tawaran — mengaktifkannya sendiri berarti orang asing yang menemukan bot ini menerima
 * peringatan ROI seluruh armada (nama subdomain, spend, earning tiap orang), karena
 * `contactAlertScope` membaca `pic` kosong sebagai "semua". Kebocoran yang bentuknya persis seperti
 * fitur yang bekerja.
 *
 * KOSONG PUN TETAP DIGAMBAR, dan itu bukan kelalaian: kalimat kosongnya adalah tempat cara kerjanya
 * tertulis. Panel yang hanya muncul saat ada isinya berarti admin yang belum pernah melihatnya akan
 * terus mencari chat id dengan cara lama.
 */
function DetectedPanel({ groups, inbox, onActivate, onDismiss, users }) {
  // Kunci baris yang sedang diproses, bukan boolean: dua baris yang tombolnya ditekan berurutan
  // tidak boleh saling mematikan, dan satu flag untuk seluruh tabel membuat semua tombol mati
  // karena satu di antaranya sedang menulis.
  const [busy, setBusy] = useState("");
  const pending = pendingChats(inbox, { users, groups });

  const run = async (key, action) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Calon Penerima</h2>
          <p>Chat yang sudah mengirim pesan ke bot tapi belum jadi penerima.</p>
        </div>
      </div>

      {pending.length === 0 ? (
        <EmptyMessage>Belum ada chat baru.</EmptyMessage>
      ) : (
        <DataTable
          columns={[
            {
              accessorKey: "title",
              header: "Nama",
              cell: ({ row }) => (
                <>
                  <strong>{row.original.title || "(tanpa nama)"}</strong>
                  {/* Nama profil Telegram boleh sama persis untuk dua orang; `@username` tidak.
                      Yang harus memutuskan mengaktifkan sebuah baris butuh yang kedua. */}
                  {row.original.username && (
                    <div className="muted-line">@{row.original.username}</div>
                  )}
                </>
              ),
            },
            {
              id: "jenis",
              accessorFn: (chat) => (isGroupChat(chat.chatId) ? "Grup" : "Non-tim"),
              header: "Jenis",
              cell: ({ getValue }) => <span className="badge muted">{getValue()}</span>,
            },
            {
              accessorKey: "chatId",
              header: "Chat ID",
              cell: ({ row }) => row.original.chatId,
            },
            {
              accessorKey: "lastSeenAt",
              header: "Menyapa terakhir",
              cell: ({ row }) => formatDateTime(row.original.lastSeenAt),
            },
            {
              id: "actions",
              header: "Actions",
              enableSorting: false,
              meta: { align: "right" },
              cell: ({ row }) => {
                const chat = row.original;
                return (
                  <div className="action-group">
                    <button
                      className="ghost-button"
                      disabled={busy === chat.key}
                      onClick={() => run(chat.key, () => onDismiss(chat))}
                      type="button"
                    >
                      Abaikan
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy === chat.key}
                      onClick={() => run(chat.key, () => onActivate(chat))}
                      type="button"
                    >
                      Aktifkan
                    </button>
                  </div>
                );
              },
            },
          ]}
          getRowId={(chat) => String(chat.key)}
          items={pending}
        />
      )}
    </section>
  );
}

/**
 * Satu baris per orang — DAFTAR, bukan tempat mengubah.
 *
 * Saklarnya ditekan di halamannya sendiri (`/notifications/orang/{id}/edit`), sepola dengan seluruh
 * resource di dashboard ini. Tabel yang saklarnya bisa ditekan langsung memang lebih pendek satu
 * klik, tapi ia menulis ke database tiap kali kursor tergelincir satu baris — di tabel setinggi
 * seluruh tim, baris yang salah tersentuh tidak meninggalkan tanda apa pun di layar.
 */
function PeoplePanel({ canManage, contacts, navigate, ownId, settings, users }) {
  // Admin melihat seluruh tim; sisanya melihat barisnya sendiri saja. Bukan karena daftar itu
  // rahasia (kolom Telegram ID sudah tampil di halaman Team untuk semua), melainkan karena baris
  // orang lain di sini tidak bisa mereka ubah — dan tombol Edit yang ditolak database adalah cara
  // tercepat membuat halaman ini terasa rusak.
  //
  // DUA SUMBER dalam satu daftar, dan itu memang yang dicari orang di tab ini: "siapa saja yang
  // dikirimi". Baris tim datang dari `users` (punya role, punya subdomain, punya akun login); baris
  // non-tim dari `notificationGroups` yang chat id-nya positif — pemilik, akuntan, siapa pun yang
  // perlu dikabari tanpa harus dibuatkan akun dashboard berikut role-nya. Dipisah jadi dua panel,
  // pertanyaan "kenapa si anu tidak menerima" harus dijawab dengan membuka dua tempat.
  const teamRows = (canManage ? users : ownId ? users.filter((row) => row.id === ownId) : []).map(
    (row) => ({
      id: row.id,
      name: row.name || row.username || row.email || "(tanpa nama)",
      note: row.email || "",
      role: row.role || "user",
      chatId: row.telegramChatId,
      topics: row.notificationTopics,
      team: true,
      editable: canManage || row.id === ownId,
      href: `/notifications/orang/${row.id}/edit`,
    }),
  );
  const contactRows = canManage
    ? (contacts || []).map((row) => ({
        id: row.id,
        name: row.label || "(tanpa nama)",
        note: row.pic ? `Peringatan ROI: subdomain milik ${row.pic}` : "",
        role: "",
        chatId: row.chatId,
        topics: row.topics,
        team: false,
        // Grup dan channel Telegram ber-id negatif, chat pribadi positif — jaminan Telegram, bukan
        // tebakan, jadi tidak ada kolom "jenis" yang harus diisi orang (dan diisi keliru). Baris
        // yang dinonaktifkan menyebut itu lebih dulu: ia tetap berdiri lengkap dengan saklarnya,
        // dan itulah bedanya dari yang dihapus.
        badge: row.enabled === false ? "Nonaktif" : isGroupChat(row.chatId) ? "Grup" : "Non-tim",
        editable: true,
        href: `/notifications/kontak/${row.id}/edit`,
      }))
    : [];
  const rows = [...teamRows, ...contactRows];

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{canManage ? "Orang" : "Notifikasi saya"}</h2>
          <p>
            {canManage
              ? "Anggota tim, orang di luar tim, dan grup. Yang belum punya Chat ID tidak bisa dikirimi apa pun."
              : "Pilih sendiri notifikasi yang ingin kamu terima di Telegram."}
          </p>
        </div>
      </div>

      <DataTable
        columns={[
          {
            accessorKey: "name",
            header: "Nama",
            cell: ({ row }) => (
              <>
                <strong>{row.original.name}</strong>
                {row.original.note && <div className="muted-line">{row.original.note}</div>}
              </>
            ),
          },
          {
            id: "role",
            accessorFn: (row) => (row.team ? row.role : row.badge),
            header: "Role",
            cell: ({ row }) =>
              row.original.team ? (
                row.original.role
              ) : (
                /* Bukan role, karena baris ini memang tidak punya satu pun: ia tidak bisa
                   login, tidak ikut siaran per role, dan tidak memegang subdomain. Kolomnya
                   mengatakan itu apa adanya alih-alih menuliskan "user" yang tidak benar. */
                <span className="badge muted">{row.original.badge}</span>
              ),
          },
          {
            accessorKey: "chatId",
            header: "Chat ID",
            cell: ({ row }) =>
              row.original.chatId ? (
                row.original.chatId
              ) : (
                <span className="badge muted">Belum diisi</span>
              ),
          },
          ...NOTIFICATION_TOPICS.map((topic) => ({
            id: `topic-${topic.key}`,
            header: topic.label,
            // Sel ini lencana turunan (pilihan orang + siaran role), bukan nilai yang pantas
            // diurutkan — kolomnya dibiarkan tanpa tombol urut.
            enableSorting: false,
            cell: ({ row }) => (
              <SubscriptionBadge
                choice={row.original.topics?.[topic.key]}
                role={row.original.team ? row.original.role : ""}
                settings={settings}
                topic={topic.key}
              />
            ),
          })),
          {
            id: "actions",
            header: "Actions",
            enableSorting: false,
            meta: { align: "right" },
            // "Kelola", sepola dengan halaman Plugin — bukan ikon pensil. Yang dibuka tombol ini
            // bukan satu kolom yang sedang dilihat orang melainkan seluruh langganan baris itu,
            // dan ikon pensil di ujung tabel menjanjikan sunting cepat di tempat.
            cell: ({ row }) =>
              row.original.editable && (
                <button
                  className="primary-button"
                  onClick={() => navigate(row.original.href)}
                  type="button"
                >
                  Kelola
                </button>
              ),
          },
        ]}
        emptyText="Akun ini belum punya baris di Team, jadi tidak ada tempat menyimpan saklarnya. Minta admin menambahkannya."
        items={rows}
      />
    </section>
  );
}

/**
 * Setelan tiap topik: saklar induknya, role yang disiarkan, dan berapa chat yang benar-benar
 * menerimanya.
 *
 * Kolom "Penerima" dihitung `topicRecipients` — aturan yang SAMA dengan yang dipakai Cloud Function
 * saat mengirim (cerminannya di functions/notifications-core.js). Itu satu-satunya cara halaman ini
 * boleh menyebut angka: daftar penerima yang dihitung dengan aturan sendiri akan menjanjikan orang
 * yang tidak pernah dikirimi apa pun, dan tidak ada yang akan tahu sampai seseorang bertanya kenapa
 * ia tidak menerima apa-apa.
 *
 * Satu-satunya tab yang MASIH diubah langsung di tabelnya, dan itu bukan kelalaian: yang di sini
 * bukan baris melainkan setelan — tiga topik yang jumlahnya tidak bertambah karena tindakan
 * siapa pun, sepola dengan tab Ad Tax di Settings. Yang punya halaman tambah/sunting sendiri adalah
 * yang punya baris: orang dan grup.
 */
function TopicPanel({ canManage, groups, settings, users, onSave }) {
  const saveTopic = (key, config, values) =>
    onSave(key, {
      ...config,
      ...values,
      roles: joinRoleList(values.roles ?? config.roles),
    });

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Topik</h2>
          <p>
            Saklar induk tiap jenis notifikasi. Dimatikan di sini, tidak ada yang menerimanya —
            berapa pun jumlah orang dan grup yang berlangganan.
          </p>
        </div>
      </div>

      {/* Urutan topik adalah urutan `NOTIFICATION_TOPICS` dan tabelnya setelan, bukan daftar —
          tidak satu pun kolom bisa diurutkan. */}
      <DataTable
        columns={[
          {
            id: "topic",
            header: "Topik",
            enableSorting: false,
            cell: ({ row }) => (
              <>
                <strong>{row.original.label}</strong>
                {/* Tidak ada keterangan kedua tentang "ambang masih mati" di sini, dan itu
                    karena saklarnya memang tinggal SATU: kolom Aktif di baris ini adalah
                    on/off Peringatan ROI, dan tab Peringatan ROI cuma memuat angkanya. */}
                <div className="muted-line">{row.original.description}</div>
              </>
            ),
          },
          {
            id: "enabled",
            header: "Aktif",
            enableSorting: false,
            cell: ({ row }) => {
              const topic = row.original;
              const config = topicSettings(settings, topic.key);
              return (
                <ToggleBox
                  checked={config.enabled}
                  disabled={!canManage}
                  id={`topic-${topic.key}-enabled`}
                  label="Aktif"
                  onChange={(value) => saveTopic(topic.key, config, { enabled: value })}
                />
              );
            },
          },
          {
            id: "roles",
            header: "Kirim juga ke semua role",
            enableSorting: false,
            cell: ({ row }) => {
              const topic = row.original;
              const config = topicSettings(settings, topic.key);
              return (
                <div className="checkbox-group">
                  {BROADCAST_ROLES.map((role) => (
                    <ToggleBox
                      checked={config.roles.includes(role)}
                      disabled={!canManage}
                      id={`topic-${topic.key}-role-${role}`}
                      key={role}
                      label={role}
                      onChange={(value) =>
                        saveTopic(topic.key, config, {
                          roles: value
                            ? [...config.roles, role]
                            : config.roles.filter((entry) => entry !== role),
                        })
                      }
                    />
                  ))}
                </div>
              );
            },
          },
          {
            id: "recipients",
            header: "Penerima",
            enableSorting: false,
            meta: { align: "right" },
            cell: ({ row }) => {
              const recipients = topicRecipients(row.original.key, { users, groups, settings });
              return recipients.length === 0 ? (
                <span className="badge muted">Tidak ada</span>
              ) : (
                <span title={recipients.map((entry) => entry.label).join(", ")}>
                  {recipients.length} chat
                </span>
              );
            },
          },
        ]}
        getRowId={(topic) => topic.key}
        items={NOTIFICATION_TOPICS}
      />
    </section>
  );
}

/**
 * Ambang peringatan ROI — kapan sync yang sudah jalan tiap jam harus berbunyi.
 *
 * PINDAH DARI `/settings?tab=peringatan`, dan tempatnya memang di sini: yang di Settings menjawab
 * "berapa ambangnya", yang di halaman ini menjawab "siapa yang dikabari" — dan satu-satunya
 * pertanyaan yang benar-benar ditanyakan orang adalah keduanya sekaligus. Selama keduanya berjauhan,
 * ambang yang dinyalakan tanpa penerima (dan sebaliknya) adalah keadaan yang tidak terlihat di layar
 * mana pun.
 *
 * Yang MENILAI tetap bukan halaman ini melainkan `functions/alerts-core.js`; di sini cuma angkanya.
 * Sengaja tidak ada cerminan aturannya di sisi UI (berbeda dari `topicRecipients` di sebelah, yang
 * memang dibaca kedua sisi): tidak ada satu pun tempat di dashboard yang menampilkan "baris ini
 * sedang melewati ambang", jadi menyalin logikanya ke sini berarti dua salinan aturan yang salah
 * satunya tidak dipakai siapa-siapa.
 *
 * SAKLAR ON/OFF-NYA TIDAK DI SINI melainkan di kolom Aktif tab Topik — satu saklar, satu tempat.
 * Sebelumnya ada dua (topiknya, dan "Nyalakan peringatan" di form ini), dan dua saklar untuk satu
 * pesan adalah bentuk yang paling sering dibaca sebagai "fiturnya rusak": yang satu dinyalakan, yang
 * lain tetap diam, dan tidak ada apa pun di layar yang menyebutkan bahwa masih ada yang kedua. Yang
 * membacanya `runAlerts` di scheduled-sync.js, dari `settings/notifications/roiAlerts.enabled`.
 *
 * Yang menahannya supaya tidak berbunyi puluhan kali pada jam pertama setelah deploy bukan lagi
 * saklar yang mati melainkan DAFTAR PENERIMANYA, sama seperti dua topik lainnya: tidak ada satu pun
 * orang atau grup yang berlangganan "Peringatan ROI" sampai seseorang menyalakannya sendiri — dan
 * yang menyalakannya sedang meminta pesan itu. Ambang di form ini adalah bawaan yang bisa disesuaikan
 * sesudah pesan pertamanya terlihat, bukan syarat sebelum yang pertama boleh dikirim.
 */
function AlertPanel({ settings, onSave, readOnly }) {
  const stored = settings || {};
  const [form, setForm] = useState(() => toAlertForm(stored));
  const [saving, setSaving] = useState(false);
  // Nilai dari database datang belakangan, dan bisa diubah admin lain dari perangkat lain.
  useEffect(() => {
    setForm(toAlertForm(stored));
  }, [stored]);

  const set = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        // `enabled` sengaja TIDAK ikut: on/off Peringatan ROI tinggal di saklar topiknya (tab
        // Topik), satu-satunya tempat. Dua saklar untuk satu pesan adalah bentuk yang paling sering
        // dibaca sebagai "fiturnya rusak" — yang satu dinyalakan, yang lain tetap diam, dan tidak
        // ada apa pun di layar yang menyebutkan bahwa masih ada yang kedua.
        //
        // Angkanya dikirim sebagai angka, bukan teks: `.validate` di database.rules.json menuntut
        // `isNumber()`, dan kotak <input type="number"> menyerahkan teks.
        minSpend: Number(form.minSpend),
        roiThreshold: Number(form.roiThreshold),
        balanceThreshold: Number(form.balanceThreshold),
        spendNoEarning: form.spendNoEarning,
        lowRoi: form.lowRoi,
        lowBalance: form.lowBalance,
      });
    } finally {
      setSaving(false);
    }
  };

  const numbersValid = [form.minSpend, form.roiThreshold, form.balanceThreshold].every(
    (value) => value !== "" && Number.isFinite(Number(value)),
  );

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-header">
        <div>
          <h2>Peringatan ROI</h2>
          <p>
            Tiap sync menilai baris ROI hari berjalan, dan yang melewati ambang dikirim ke penerima
            topik "Peringatan ROI" — sekali sehari per subdomain.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="alerts-min-spend">Belanja minimum (Rp)</label>
          <input
            className="control"
            disabled={readOnly}
            id="alerts-min-spend"
            inputMode="numeric"
            min="0"
            onChange={set("minSpend")}
            step="1000"
            type="number"
            value={form.minSpend}
          />
          <small className="muted-line">
            Lantai untuk dua aturan pertama. Tanpa ini, tiap campaign yang baru menyala memenuhi
            syarat "ROI di bawah ambang".
          </small>
        </div>

        <div className="field">
          <label htmlFor="alerts-roi">Ambang ROI (%)</label>
          <input
            className="control"
            disabled={readOnly}
            id="alerts-roi"
            inputMode="decimal"
            onChange={set("roiThreshold")}
            step="1"
            type="number"
            value={form.roiThreshold}
          />
          <small className="muted-line">
            Berbunyi kalau ROI turun sampai angka ini atau di bawahnya. Boleh negatif.
          </small>
        </div>

        <div className="field">
          <label htmlFor="alerts-balance">Ambang saldo Meta (Rp)</label>
          <input
            className="control"
            disabled={readOnly}
            id="alerts-balance"
            inputMode="numeric"
            min="0"
            onChange={set("balanceThreshold")}
            step="1000"
            type="number"
            value={form.balanceThreshold}
          />
          <small className="muted-line">
            Campaign yang saldonya habis berhenti tengah malam — termasuk yang sedang untung.
          </small>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <span>Aturan yang aktif</span>
          {[
            ["spendNoEarning", "Belanja jalan, earning masih Rp 0"],
            ["lowRoi", "ROI di bawah ambang"],
            ["lowBalance", "Saldo Meta menipis"],
          ].map(([key, label]) => (
            <Switch
              checked={form[key]}
              disabled={readOnly}
              id={`alerts-${key}`}
              key={key}
              label={label}
              // `set()` di atas menerjemahkan event DOM; saklar sudah menyerahkan nilai jadi, jadi
              // ia menulis langsung alih-alih mengarang event tiruan berbentuk checkbox.
              onChange={(next) => setForm((current) => ({ ...current, [key]: next }))}
            />
          ))}
          {/* Yang paling perlu dibaca orang sebelum menyalakan ini, dan alasan fitur ini bisa
              dipercaya: baris yang laporannya gagal TIDAK ikut dinilai. */}
          <small className="muted-line">
            Baris yang earning atau spend-nya gagal diambil dilewati, bukan dihitung nol — laporan
            yang gagal adalah isu sync, dan rinciannya ada di ikon peringatan pada topbar (dan di
            topik "Kegagalan sync").
          </small>
        </div>
      </div>

      {!readOnly && (
        <div className="form-actions">
          <button className="primary-button" disabled={saving || !numbersValid} type="submit">
            <Save size={16} />
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      )}
    </form>
  );
}

// Bentuk form dari nilai tersimpan. Yang belum pernah disimpan memakai bawaan `DEFAULT_ALERTS`,
// jadi kotaknya tidak pernah kosong — kecuali `enabled`, yang bawaannya memang mati.
function toAlertForm(stored) {
  const value = (key) =>
    stored[key] === undefined || stored[key] === null || stored[key] === ""
      ? DEFAULT_ALERTS[key]
      : stored[key];

  return {
    minSpend: String(value("minSpend")),
    roiThreshold: String(value("roiThreshold")),
    balanceThreshold: String(value("balanceThreshold")),
    spendNoEarning: value("spendNoEarning") === true,
    lowRoi: value("lowRoi") === true,
    lowBalance: value("lowBalance") === true,
  };
}

/**
 * Keadaan langganan satu orang pada satu topik, dalam satu lencana.
 *
 * Tiga keadaan dan bukan dua, karena "ikut lewat siaran role" memang bukan hal yang sama dengan
 * "menyalakannya sendiri": yang pertama ikut berubah begitu role-nya berganti atau siarannya
 * dicabut, yang kedua bertahan. Dilebur jadi satu centang, tidak ada yang bisa menjawab kenapa
 * seseorang tiba-tiba berhenti menerima.
 */
function SubscriptionBadge({ choice, role, settings, topic }) {
  if (choice === true) return <span className="badge success">Ya</span>;
  if (choice === false) return <span className="badge muted">Dimatikan</span>;
  // Tanpa role tidak ada siaran yang bisa menjangkaunya — itu baris non-tim, dan satu-satunya yang
  // menentukan adalah saklarnya sendiri.
  if (!role) return <span className="muted-cell">-</span>;

  const bySiaran = topicSettings(settings, topic).roles.some((entry) =>
    String(role || "user")
      .toLowerCase()
      .split(",")
      .map((part) => part.trim())
      .includes(entry),
  );
  return bySiaran ? (
    <span className="badge">Ikut role</span>
  ) : (
    <span className="muted-cell">-</span>
  );
}

/**
 * Satu saklar berlabel — pembungkus tipis di atas `<Switch>`.
 *
 * Tetap ada sebagai nama tersendiri karena ia dipakai di empat berkas dengan kontrak yang sama, dan
 * yang berubah di sini adalah RUPANYA saja: dulu kotak centang, sekarang saklar seperti di seluruh
 * dashboard. Yang dijawabnya memang sebuah setelan — "orang ini menerima topik ini" — bukan pilihan
 * baris untuk tindakan berikutnya, jadi ia memang termasuk yang berpindah.
 */
export function ToggleBox({ checked, disabled, id, label, onChange }) {
  return <Switch checked={checked} disabled={disabled} id={id} label={label} onChange={onChange} />;
}
