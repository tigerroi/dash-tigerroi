import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDatesInText, formatDateTime } from "../../lib/formatDate";
import { CAUSE_ORDER, ISSUE_CAUSES, issueCause } from "../../lib/syncIssueCause";
import { collapseIssues, splitCredentialIssues } from "../../lib/syncIssueGroups";
import { anyRetryRunning, retryStatus } from "../../lib/syncRetry";
import { Dialog } from "./Dialog";

// Ikon peringatan di topbar: satu tempat yang mengatakan sesuatu di sync terakhir gagal, dan
// membuka rinciannya.
//
// Sebelum ini kegagalan per-akun hanya masuk `console.error` di dalam Cloud Function. Laporan GAM
// yang gagal untuk satu network menuliskan earning 0 ke barisnya, dan tidak ada satu pun tanda di
// layar bahwa angkanya bukan angka sungguhan — sebuah domain penuh bisa hilang dari dashboard
// tanpa ada yang tahu sampai seseorang membandingkannya dengan AdSense.
//
// Yang ditampilkan adalah keadaan run TERAKHIR (tiap run menimpa cabangnya sendiri), jadi ikon
// yang padam berarti masalahnya sudah tidak ada lagi, bukan sekadar sudah dibaca.
export function SyncIssuesAlert({ issues, retries, runs, onOpenCredentials }) {
  const [open, setOpen] = useState(false);
  // Kegagalan yang sebabnya satu kredensial diangkat lebih dulu, baru sisanya dikelompokkan per
  // golongan. Urutan ini yang menentukan: `withCauses` di dalam cabang yang isinya sudah pindah
  // akan menggambar golongan kosong.
  const { cards, groups, total } = useMemo(() => {
    const all = toGroups(issues, retries, runs);
    const split = splitCredentialIssues(all);
    return {
      cards: split.cards,
      groups: split.groups.map(withCauses),
      // Tetap menghitung SELURUH bagian yang gagal, termasuk yang diangkat: yang berubah cuma
      // tempat menggambarnya, bukan berapa banyak yang benar-benar tidak tersync.
      total: all.reduce((sum, group) => sum + group.items.length, 0),
    };
  }, [issues, retries, runs]);
  const retrying = anyRetryRunning(retries);
  const now = useTick(open && groups.some((group) => group.retry));

  if (total === 0) {
    return null;
  }

  return (
    <>
      <button
        className="sync-alert"
        onClick={() => setOpen(true)}
        title={
          retrying
            ? "Bagian yang gagal sedang dicoba lagi. Klik untuk rinciannya."
            : "Ada bagian sync yang gagal. Klik untuk rinciannya."
        }
        type="button"
      >
        {/* Ikonnya BERGANTI, bukan sekadar berputar: yang sedang mencoba lagi tidak sedang meminta
            tindakan orang, dan segitiga peringatan yang berputar tetap terbaca sebagai "perbaiki
            aku sekarang". */}
        {retrying ? <RefreshCw className="icon-spin" size={15} /> : <TriangleAlert size={15} />}
        <span>
          {total} masalah sync{retrying ? " · mencoba lagi" : ""}
        </span>
      </button>

      {/* Lewat portal ke <body>, bukan di tempatnya berdiri. Tombolnya ada di dalam `.topbar`, dan
          `.topbar` memakai backdrop-filter — properti itu membuat elemennya jadi containing block
          untuk keturunan `position: fixed`, jadi `inset: 0` milik backdrop berhenti di tepi bawah
          header alih-alih menutupi seluruh layar. */}
      {open && (
        <Dialog
          className="sync-issues-dialog"
          headClassName="sync-issues-head"
          onClose={() => setOpen(false)}
          subtitle={
            <>
              {total} bagian gagal. Angka yang terpengaruh tampil "-" di tabel, bukan 0 — nol yang
              dikarang akan terbaca sebagai ROI -100%.
            </>
          }
          title="Sync terakhir tidak lengkap"
        >
          <div className="sync-issues-body">
            {/* Berdiri PALING ATAS dan di luar cabang mana pun. Satu kredensial yang aksesnya
                dicabut menjatuhkan tiap modul yang memakainya — sebelum ini petcins berdiri
                enam kali di panel yang sama, tiap kartunya menyuruh hal yang persis sama, dan
                yang tenggelam di bawahnya adalah kegagalan lain yang tidak ada hubungannya. */}
            {cards.length > 0 && (
              <section className="sync-issues-group">
                <div className="sync-issues-group-head">
                  <strong>Kredensial Google</strong>
                  <span className="badge danger">
                    {cards.reduce((sum, card) => sum + card.count, 0)}
                  </span>
                </div>
                <div className="sync-issue-cause">
                  <p className="sync-issue-cause-head action">
                    <span>PERLU DIHUBUNGKAN ULANG</span>
                    <small>{cards.length}</small>
                  </p>
                  <p className="sync-issue-cause-note">
                    Satu kredensial yang aksesnya hilang menjatuhkan setiap akun yang memakainya, di
                    setiap bagian sync. Perbaikannya satu: hubungkan ulang di halaman Google API.
                  </p>
                  {cards.map((card) => (
                    <article className="sync-issue" key={card.key}>
                      <div className="sync-issue-head">
                        <strong>{card.credential}</strong>
                        <span>{card.places.join(" · ")}</span>
                      </div>
                      {card.says.map((say) => (
                        <p className="sync-issue-say" key={say}>
                          {say}
                        </p>
                      ))}
                      <p className="sync-issue-targets">
                        {card.targets.length} akun: {card.targets.join(", ")}
                      </p>
                      {/* Akibatnya tetap disebut satu per satu. Itu yang membedakan
                          penggabungan ini dari sekadar menyembunyikan baris: yang hilang cuma
                          pengulangan kalimat perintahnya, bukan daftar yang angkanya sedang
                          tidak benar di layar. */}
                      {card.impacts.length > 0 && (
                        <ul className="sync-issue-impacts">
                          {card.impacts.map((impact) => (
                            <li key={impact}>{impact}</li>
                          ))}
                        </ul>
                      )}
                      {onOpenCredentials && (
                        <p className="sync-issue-action">
                          <button
                            className="ghost-button"
                            onClick={() => {
                              setOpen(false);
                              onOpenCredentials();
                            }}
                            type="button"
                          >
                            Buka Google API <ArrowRight size={13} />
                          </button>
                        </p>
                      )}
                      <details className="sync-issue-detail">
                        <summary>Detail teknis</summary>
                        {card.messages.map((message) => (
                          <p className="sync-issue-message" key={message}>
                            {message}
                          </p>
                        ))}
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {groups.map((group) => (
              <section className="sync-issues-group" key={group.label}>
                <div className="sync-issues-group-head">
                  <strong>{group.label}</strong>
                  <span className="badge danger">{group.items.length}</span>
                  {group.checkedAt && <small>diperiksa {formatDateTime(group.checkedAt)}</small>}
                </div>
                <RetryNote now={now} retry={group.retry} />
                {group.causes.map((cause) => (
                  <div className="sync-issue-cause" key={`${group.label}-${cause.key}`}>
                    {/* Judul golongan berdiri SEKALI di atas kelompoknya, bukan sebagai lencana
                      di tiap baris: enam baris yang sama-sama berbunyi "GANGGUAN DI SISI
                      PENYEDIA" adalah enam kali kalimat yang berhenti dibaca di baris kedua. */}
                    <p className={`sync-issue-cause-head ${cause.key}`}>
                      <span>{cause.heading}</span>
                      <small>{cause.items.length}</small>
                    </p>
                    <p className="sync-issue-cause-note">{cause.note}</p>
                    {/* Sembilan network satu kredensial yang aksesnya dicabut adalah sembilan
                      kartu yang bunyinya sama persis, untuk satu tombol Login yang sama —
                      dan daftar yang mengulang kalimatnya berhenti dibaca di kartu kedua.
                      Yang digabung cuma yang benar-benar satu tindakan; hitungan di kepala
                      golongan tetap menyebut AKUN. */}
                    {collapseIssues(cause.items).map((item) => (
                      <article className="sync-issue" key={`${group.label}-${item.key}`}>
                        <div className="sync-issue-head">
                          <strong>{item.title}</strong>
                          <span>{item.source}</span>
                        </div>
                        {/* Kalimat manusianya lebih dulu, pesan API-nya di balik "Detail
                          teknis". Yang membuka panel ini memutuskan SATU hal — perlu dikerjakan
                          sekarang atau tidak — dan "POST /networks/23352267851/reports/
                          8298846231:run -> 503" tidak menjawabnya untuk siapa pun yang tidak
                          menulis kodenya. Yang memperbaikinya nanti tetap butuh kalimat
                          persisnya, jadi ia disembunyikan, bukan dibuang. */}
                        {item.say && <p className="sync-issue-say">{item.say}</p>}
                        {item.count > 1 && (
                          // Nama akunnya tetap disebut satu per satu: yang dibaca orang di
                          // halaman tujuan adalah baris per akun, dan "9 akun" tanpa namanya
                          // tidak bisa dicocokkan dengan apa pun di sana.
                          <p className="sync-issue-targets">
                            {item.count} akun: {item.targets.join(", ")}
                          </p>
                        )}
                        {item.impact && <p className="sync-issue-impact">Akibat: {item.impact}</p>}
                        {/* Satu tombol ke tempat perbaikannya, dan hanya untuk yang memang
                            diperbaiki di sana: kredensial Google yang golongannya menuntut
                            tindakan orang. Tombol yang berdiri di sebelah gangguan sementara
                            mengirim orang mengerjakan sesuatu yang tidak menyelesaikan apa
                            pun. Disembunyikan juga dari yang tidak boleh membuka halamannya —
                            tombol yang berujung "akses ditolak" lebih buruk daripada tidak
                            ada tombol. */}
                        {item.credential && item.cause === "action" && onOpenCredentials && (
                          <p className="sync-issue-action">
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setOpen(false);
                                onOpenCredentials();
                              }}
                              type="button"
                            >
                              Buka Google API <ArrowRight size={13} />
                            </button>
                          </p>
                        )}
                        {item.say ? (
                          <details className="sync-issue-detail">
                            <summary>Detail teknis</summary>
                            {item.messages.map((message) => (
                              <p className="sync-issue-message" key={message}>
                                {message}
                              </p>
                            ))}
                          </details>
                        ) : (
                          // Golongan yang belum bisa dipastikan tidak punya kalimat manusianya,
                          // dan di situ pesan aslinya adalah satu-satunya keterangan yang ada —
                          // menyembunyikannya berarti barisnya tidak mengatakan apa-apa.
                          <p className="sync-issue-message">{item.message}</p>
                        )}
                      </article>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>

          <footer className="sync-issues-foot">
            <small>
              Bagian yang gagal dicoba lagi sendiri secara berjarak; sesudah percobaan terakhir,
              yang mencoba lagi adalah sync penuh berikutnya. Riwayat tiap run ada di Settings → Log
              Sync Otomatis.
            </small>
            <button className="ghost-button" onClick={() => setOpen(false)} type="button">
              Tutup
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}

/**
 * Jam yang berdetak selama dialognya terbuka, supaya "dalam 4 menit" tidak membeku di angka yang
 * dibaca saat panel dibuka.
 *
 * Setengah menit sekali, bukan tiap detik: yang ditampilkan berbutir menit, dan detik yang berdetak
 * di belakang layar cuma merender ulang dialog enam puluh kali untuk kalimat yang sama. Berhenti
 * saat dialognya tertutup — tidak ada yang membacanya, dan flag `running` sendiri datang dari
 * langganan RTDB, bukan dari jam ini.
 */
function useTick(active) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

/**
 * Satu baris di bawah judul kelompok: sedang dicoba lagi, atau kapan percobaan berikutnya.
 *
 * Tanpa ini, panel yang sama persis berdiri di layar selama masalahnya diperbaiki sendiri, dan
 * orang yang membukanya tidak punya cara membedakan "sedang ditangani" dari "diam saja sampai jam
 * berikutnya" — lalu mengejar sesuatu yang sedang berjalan.
 */
function RetryNote({ retry, now }) {
  const status = retryStatus(retry, now);
  if (!status) return null;

  return (
    <p className={`sync-retry-note${status.running ? " running" : ""}`}>
      {status.running ? <RefreshCw className="icon-spin" size={13} /> : <RefreshCw size={13} />}
      <span>{status.label}</span>
      {/* Targetnya disebut namanya: sebuah kelompok bisa memuat sepuluh situs sementara yang benar-
          benar sedang diulang tinggal satu. */}
      <small>{status.targets}</small>
    </p>
  );
}

// `dashboard/syncIssues` berisi satu cabang per modul sync, masing-masing ditimpa utuh oleh run
// terakhirnya. Cabang dengan count 0 dilewati — itu justru kabar baik.
function toGroups(issues, retries, runs) {
  const groups = Object.entries(issues || {})
    .map(([key, branch]) => ({
      label: branch?.label || key,
      checkedAt: branch?.checkedAt || "",
      // Antreannya dicari lewat NAMA CABANG yang sama, bukan lewat peta nama di antara keduanya:
      // `syncIssues/plugin` dan `syncRetries/plugin` ditulis modul yang sama, dan peta nama adalah
      // cara satu cabang baru diam-diam kehilangan indikatornya.
      retry: retries?.[key] || null,
      items: toItems(branch?.items),
    }))
    .filter((group) => group.items.length > 0);

  // Tahap yang gagal seluruhnya tidak sempat menulis daftar isunya sendiri — run-nya berhenti di
  // tengah. Itu justru kegagalan yang paling besar akibatnya, jadi ia diambil dari log run.
  const stages = failedStages(runs);
  if (stages.items.length) groups.unshift(stages);

  return groups;
}

function toItems(items) {
  const list = Array.isArray(items) ? items : Object.entries(items || {});
  return list
    .map((entry, index) => {
      const [key, value] = Array.isArray(entry) ? entry : [String(index), entry];
      const message = value?.message || "Tidak ada pesan error.";
      const cause = issueCause(message);
      return {
        key,
        source: value?.source || "Sync",
        target: value?.target || "-",
        // Kredensial Google yang dipakai akun ini, ditulis sisi sync (`syncIssue`). Ia yang
        // menggabungkan baris-baris yang menuntut satu tindakan yang sama, dan yang menentukan
        // kartu mana yang berhak punya tombol ke halaman kredensialnya.
        credential: value?.credential || "",
        message,
        cause: cause.key,
        say: cause.say,
        // Kalimat akibatnya disusun sisi sync, yang tidak punya pemformat tanggal dashboard ini —
        // dan tanggal ISO di tengah kalimat ("2026-08-25 s/d 2026-08-28") adalah satu-satunya
        // tanggal di seluruh layar yang tidak berbunyi "25 Agu 2026". Diformat di sini, saat
        // dirender, seperti tanggal mana pun.
        impact: formatDatesInText(value?.impact || ""),
      };
    })
    .filter((item) => item.message);
}

/**
 * Isi satu cabang dikelompokkan per ASAL MASALAH — bentuk yang sama dengan pesan Telegram
 * (`syncIssueMessage`), dan bukan kebetulan: dua tempat yang menceritakan keadaan yang sama harus
 * menceritakannya dengan cara yang sama, atau yang membaca keduanya akan mengira ia sedang membaca
 * dua kejadian.
 *
 * Cabangnya TETAP jadi kelompok terluar, tidak diganti golongan. Antrean percobaan ulang tinggal
 * per cabang (`syncRetries/{cabang}`), dan satu baris "dicoba lagi dalam 4 menit" yang berdiri di
 * atas campuran cabang tidak menyebut apa pun yang benar.
 */
function withCauses(group) {
  const byCause = new Map();
  for (const item of group.items) {
    if (!byCause.has(item.cause)) byCause.set(item.cause, []);
    byCause.get(item.cause).push(item);
  }

  const causes = CAUSE_ORDER.filter((key) => byCause.has(key)).map((key) => ({
    ...ISSUE_CAUSES[key],
    items: byCause.get(key),
  }));

  return { ...group, causes };
}

function failedStages(runs) {
  const list = Array.isArray(runs)
    ? runs
    : Object.entries(runs || {}).map(([id, run]) => ({ id, ...run }));
  const latest = list
    .filter(Boolean)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0];
  const stages = Array.isArray(latest?.stages)
    ? latest.stages
    : Object.values(latest?.stages || {});

  return {
    label: "Tahap sync yang gagal",
    // Tahap yang jatuh seluruhnya tidak punya rencana percobaan ulang: yang gagal bukan satu target
    // yang bisa dihubungi lagi, melainkan seluruh langkahnya — dan run berikutnyalah yang
    // mengulanginya.
    retry: null,
    checkedAt: latest?.finishedAt || latest?.startedAt || "",
    items: stages
      .filter((stage) => stage?.ok === false)
      .map((stage, index) => {
        const message = stage.detail || "Tidak ada pesan error.";
        const cause = issueCause(message);
        return {
          key: `stage-${index}`,
          source: "Run terjadwal",
          target: stage.name || "(tahap tanpa nama)",
          message,
          cause: cause.key,
          say: cause.say,
          impact: "Seluruh tahap ini dilewati pada run terakhir.",
        };
      }),
  };
}
