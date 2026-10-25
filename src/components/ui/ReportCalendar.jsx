import { AlertTriangle, BellRing, ChevronLeft, ChevronRight } from "lucide-react";
import { formatRoiPercent } from "../../lib/adTax";
import { formatDate, formatMonth } from "../../lib/formatDate";
import { compactRupiah } from "../../lib/money";
import { renderCell } from "../../lib/renderCell";
import { CellPopover } from "./CellPopover";
import { MetaSpendNote } from "./MetaSpendNote";

const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/**
 * Kalender laporan: satu petak per hari, isinya angka hari itu.
 *
 * ═══ SATU PETAK MEMUAT TIGA BARIS, DAN ITU BATASNYA ═══
 *
 * Yang dipilih untuk ditampilkan bukan "semua yang kita punya" melainkan yang menjawab pertanyaan
 * yang membuat orang membuka kalender: ROI hari itu, uang yang keluar dan masuk, dan apa yang
 * MENUNTUT TINDAKAN (baris yang angkanya tidak lengkap, pengingat yang jatuh tempo). Sisanya —
 * peringkat subdomain, rincian sumber earning, belanja per advertiser — tinggal di panel yang
 * terbuka saat petaknya diklik. Petak yang memuat delapan angka tidak bisa dibaca sekilas, dan
 * "sekilas" adalah satu-satunya hal yang bisa diberikan kalender yang tidak bisa diberikan tabel.
 *
 * Angkanya dipadatkan (`compactRupiah`) karena petaknya selebar sepertujuh layar; nominal penuh
 * ada di panel rincian, tempat lebarnya memang ada.
 */
export function ReportCalendar({
  coverage,
  days,
  filter,
  monthKey,
  onMonthChange,
  onSelect,
  scope,
  selected,
  totals,
}) {
  return (
    <>
      <div className="calendar-bar">
        <div className="calendar-nav">
          <button
            aria-label="Bulan sebelumnya"
            className="daterange-nav"
            onClick={() => onMonthChange(-1)}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{formatMonth(`${monthKey}-01`)}</strong>
          <button
            aria-label="Bulan berikutnya"
            className="daterange-nav"
            onClick={() => onMonthChange(1)}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
          {/* Siapa yang sedang tergambar, sebagai teks, di sebelah bulannya. Kontrol filternya
              terlipat ke dalam dialog, dan kalender satu advertiser yang tidak menyebut namanya
              akan dibaca sebagai kalender seluruh bisnis — persis alasan ringkasan filter di tab
              Grafik. Totalnya di sebelah kanan adalah total lingkup ini, bukan total armada. */}
          {scope && <span className="calendar-scope">{scope}</span>}
          {/* Selisih terhadap Pendapatan Laba Rugi (total usaha), di sebelah lingkupnya sendiri — bukan sebagai
              baris tersendiri, yang akan mendorong petak-petak turun tiap bulan yang cakupannya
              belum penuh. Angkanya dipadatkan seperti isi petak; kalimat lengkapnya di title,
              karena yang perlu diketahui bukan cuma "ada selisih" melainkan di mana
              memperbaikinya. */}
          {coverage && (
            <span
              className="calendar-coverage"
              title={`${compactRupiah(coverage.gap)} dari ${compactRupiah(
                coverage.business,
              )} pendapatan bulan ini tidak punya baris ROI, jadi tidak terhitung di kalender dan grafik — tapi ikut di Pendapatan Laba Rugi. Sebabnya subdomain yang belum terdaftar atau campaign yang belum dipetakan; perbaikannya di /sub-domains.`}
            >
              {compactRupiah(coverage.gap)} di luar cakupan
            </span>
          )}
        </div>
        {/* Total sebulan berdiri di kepala, bukan di sel mana pun: ia bukan angka sebuah hari, dan
            satu petak yang memuat angka bulanan adalah petak yang salah dibaca setiap kali. */}
        <dl className="calendar-totals">
          <Total label="Total Spend" value={totals.totalSpending} />
          <Total label="Earning" value={totals.earning} />
          <Total label="Profit" value={totals.profit} />
          <div>
            <dt>ROI</dt>
            <dd className={totals.roi !== "" && totals.roi < 0 ? "money-negative" : ""}>
              {formatRoiPercent(totals.roi)}
            </dd>
          </div>
        </dl>
        {filter}
      </div>

      <div className="calendar-grid calendar-weekdays">
        {WEEKDAYS.map((label) => (
          <span className="daterange-weekday" key={label}>
            {label}
          </span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day) => (
          <CalendarCell
            day={day}
            key={day.key}
            onSelect={onSelect}
            selected={day.key === selected}
          />
        ))}
      </div>
    </>
  );
}

// Satu angka bernama, dipakai di kepala kalender maupun di panel rincian. Warnanya diserahkan
// pada `renderCell` — sama dengan tiap angka uang lain di dashboard ini, jadi tidak ada satu pun
// tempat di layar yang memakai hijau/merah dengan arti yang berbeda.
function Total({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{renderCell(value, "total")}</dd>
    </div>
  );
}

function CalendarCell({ day, onSelect, selected }) {
  const { summary, potential } = day;
  // Berapa SUBDOMAIN yang angkanya belum utuh — bukan berapa sebab. Satu chip, bukan satu chip per
  // sebab: dua lencana berdampingan yang sama-sama berarti "angka hari ini belum utuh" cuma memakan
  // baris ketiga petak, dan sebabnya sudah dipecah di tooltip dan di panel rincian — tempat orang
  // sudah memutuskan untuk melihat lebih dekat.
  const incomplete = summary ? summary.incompleteSubDomains : 0;
  const pendingReminders = day.reminders.filter((item) => !item.done).length;

  return (
    <button
      aria-current={day.isToday ? "date" : undefined}
      className={[
        "calendar-cell",
        day.inMonth ? "" : "outside",
        day.isToday ? "is-today" : "",
        day.rank ? `is-rank-${day.rank}` : "",
        selected ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(day.key)}
      // Medali yang cuma warna adalah medali yang tidak bisa dibaca orang yang tidak membedakan
      // emas dari perunggu — dan tidak bisa dibaca siapa pun yang belum tahu artinya. Bentuknya
      // tetap cuma border (tidak ada yang didorong turun di dalam petak), yang ditambah cuma
      // namanya saat kursor berhenti di situ.
      title={day.rank ? `ROI tertinggi ke-${day.rank} bulan ini` : undefined}
      type="button"
    >
      <span className="calendar-cell-head">
        <span className="calendar-day-number">{day.day}</span>
        {/* Hari berjalan dibaca dari tanda di barisnya, bukan dari jam browser — dan itu yang
            membuat angkanya boleh dibaca sebagai setengah hari alih-alih hari yang buruk. */}
        {summary?.partial && <span className="calendar-flag">berjalan</span>}
      </span>

      {summary ? (
        <span className="calendar-cell-body">
          <span
            className={`calendar-roi${summary.roi !== "" && summary.roi < 0 ? " money-negative" : ""}`}
          >
            {formatRoiPercent(summary.roi)}
          </span>
          <span className="calendar-money">
            <span className="calendar-out">{money(summary.totalSpending)}</span>
            <span aria-hidden="true">→</span>
            <span className="calendar-in">{money(summary.earning)}</span>
          </span>
        </span>
      ) : (
        // Hari yang belum punya baris sama sekali. Untuk hari depan itu wajar; untuk hari lampau
        // itu kabar, dan keduanya sama-sama tidak boleh digambar sebagai Rp 0.
        <span className="calendar-cell-body">
          <span className="calendar-empty">{day.isFuture ? "" : "belum ada data"}</span>
        </span>
      )}

      <span className="calendar-chips">
        {incomplete > 0 && (
          <span className="calendar-chip warning" title={incompleteText(summary)}>
            <AlertTriangle size={11} /> {incomplete}
          </span>
        )}
        {pendingReminders > 0 && (
          <span className="calendar-chip info" title={reminderTitles(day.reminders)}>
            <BellRing size={11} /> {pendingReminders}
          </span>
        )}
      </span>

      {/* Potensi: median hari-dalam-minggu yang sama dari riwayat. Digambar pucat dan berlabel,
          dan HANYA untuk hari ini ke depan — di hari lampau ia akan berdiri di sebelah angka nyata
          dan terbaca sebagai vonis. */}
      {potential && (
        <span className="calendar-potential" title={`Median ${potential.samples} hari serupa`}>
          potensi {money(potential.earning)}
        </span>
      )}
    </button>
  );
}

function money(value) {
  return value === "" || value === null || value === undefined ? "-" : compactRupiah(value);
}

/**
 * Kenapa angka sebuah hari belum utuh, per SEBAB — sebagai data, bukan sebagai kalimat.
 *
 * Tiap sebab menuntut tindakan di tempat yang berbeda, dan itu seluruh alasan keempatnya tidak
 * dilebur jadi satu angka. Yang membacanya cuma perlu tahu satu hal: apa yang harus dia buka
 * berikutnya — jadi tiap baris membawa `hint`-nya sendiri.
 *
 * Dikembalikan sebagai daftar supaya dua pemakainya bisa memilih bentuknya: catatan di panel
 * menggambarnya sebagai baris di dalam popover, tooltip lencana di petak merangkainya jadi satu
 * baris teks (atribut `title` tidak bisa memuat apa pun selain teks).
 */
function incompleteReasons(summary) {
  const reasons = [];
  if (summary.earningUnknown) {
    reasons.push({
      count: summary.earningUnknown,
      label: "tanpa earning",
      hint: "Laporan Google Ad Manager untuk network-nya gagal pada sync terakhir. Yang memperbaiki sisi sync — ikon peringatan di topbar menyebut network mana.",
    });
  }
  if (summary.unmapped) {
    reasons.push({
      count: summary.unmapped,
      label: "belum terpetakan ke campaign Meta",
      hint: "Tidak ada campaign Meta yang mengarah ke subdomain itu — entah memang tidak diiklankan, entah Kode Campaign-nya belum didaftarkan di /sub-domains → Edit.",
    });
  }
  if (summary.unavailable) {
    reasons.push({
      count: summary.unavailable,
      label: "spend Meta gagal diambil",
      hint: "Campaign-nya ada, tapi sisi Meta pada run itu tidak lengkap. Yang memperbaiki sisi sync, bukan /sub-domains.",
    });
  }
  // Sisa yang tidak masuk kedua sebab di atas: baris lama yang tidak membawa `metaMissing`.
  const untold = summary.spendUnknown - summary.unmapped - summary.unavailable;
  if (untold > 0) {
    reasons.push({
      count: untold,
      label: "tanpa spend Meta, sebabnya tidak tercatat",
      hint: "Baris yang ditulis sync versi lama, sebelum sebabnya ikut disimpan. Tidak ada yang bisa dilakukan pada baris itu selain menunggu hari itu disync ulang.",
    });
  }

  return reasons;
}

// Satu kalimat penuh untuk atribut `title` lencana di petak. Bunyinya harus sama dengan yang
// dibaca orang di panel rincian: yang membaca tooltip lalu membukanya tidak boleh menemukan dua
// cerita yang berbeda.
function incompleteText(summary) {
  const parts = incompleteReasons(summary).map((r) => `${r.count} ${r.label}`);
  return `${summary.incompleteSubDomains} dari ${summary.subDomains} subdomain angkanya belum utuh: ${parts.join(", ")}`;
}

// Judul pengingat yang belum ditandai selesai, untuk tooltip lencana pengingat di petak. Yang
// SUDAH selesai dilewati: lencananya sendiri cuma menghitung yang belum, dan tooltip yang menyebut
// baris yang tidak ikut dihitung membuat angkanya terbaca salah.
function reminderTitles(reminders) {
  return reminders
    .filter((item) => !item.done)
    .map((item) => item.title)
    .join(" · ");
}

/**
 * Panel rincian satu hari, DI SEBELAH KANAN kalendernya.
 *
 * Di bawah kalender (tempatnya semula) ia mendorong petak-petak keluar dari layar pertama: begitu
 * sebuah tanggal diklik, yang dilihat orang justru bukan tanggal-tanggal lain. Berdampingan, petak
 * yang sedang dibuka tetap terlihat bersama tetangganya — dan membandingkan satu hari dengan hari
 * sebelahnya adalah satu-satunya hal yang bisa diberikan kalender dan tidak bisa diberikan tabel.
 *
 * Kolomnya sempit, jadi daftar subdomain BUKAN tabel. Enam kolom di lebar 320px berarti tiap kolom
 * memuat dua kata dan seluruh angkanya membungkus; yang dipakai di sini adalah kartu per subdomain
 * — nama dan ROI di baris pertama, uangnya di baris kedua — plus batang proporsi belanja yang
 * membuat "siapa yang memakan anggaran hari itu" terbaca tanpa membaca satu angka pun.
 */
export function CalendarDayPanel({ cell, detail, expenses, canReadExpenses }) {
  const summary = cell?.summary;
  // Pembanding batang: pembelanja TERBESAR hari itu = 100%. Diukur terhadap total hari, seluruh
  // batang jadi sliver di hari yang belanjanya menyebar rata — yang seharusnya jadi perbandingan
  // berubah jadi hiasan.
  const topSpend = detail.subDomains.reduce(
    (max, item) => (item.spendingKnown && item.totalSpending > max ? item.totalSpending : max),
    0,
  );

  return (
    // `key` tanggalnya: berpindah hari MELEPAS panel ini dan memasang yang baru, jadi animasi
    // masuknya berjalan lagi. Tanpa itu, mengklik tanggal lain cuma mengganti angka di tempat, dan
    // tidak ada apa pun di layar yang mengabarkan bahwa panelnya sudah bicara tentang hari lain.
    <aside className="panel calendar-detail" key={cell.key}>
      <div className="calendar-detail-head">
        <div>
          <h2>{formatDate(cell.key)}</h2>
          <p>
            {summary
              ? `${summary.subDomains} subdomain · ${summary.rows} baris`
              : "Belum ada baris ROI untuk hari ini."}
          </p>
        </div>
        {summary?.partial && <span className="calendar-flag">berjalan</span>}
      </div>

      {summary && (
        <>
          {/* ROI berdiri sendiri di atas, bukan sebagai salah satu dari sepuluh angka berukuran
              sama: ia satu-satunya yang menjawab "hari ini bagus atau tidak", dan angka-angka di
              bawahnya ada untuk menjelaskan jawabannya. */}
          <div className="calendar-headline">
            <strong className={summary.roi !== "" && summary.roi < 0 ? "money-negative" : ""}>
              {formatRoiPercent(summary.roi)}
            </strong>
            <span>
              {money(summary.totalSpending)} <span aria-hidden="true">→</span>{" "}
              {money(summary.earning)}
            </span>
          </div>

          <dl className="calendar-detail-stats">
            <Total label="Spending" value={summary.spending} />
            <Total label="Ad Tax" value={summary.adTax} />
            <Total label="GAM" value={summary.gam} />
            <Total label="AdSense" value={summary.adsense} />
            <Total label="Profit" value={summary.profit} />
            <div>
              <dt>Klik</dt>
              <dd>{summary.earningKnown ? summary.clicks.toLocaleString("id-ID") : "-"}</dd>
            </div>
            <div>
              <dt>eCPM</dt>
              <dd>
                {summary.earningKnown && summary.impressions
                  ? renderCell((summary.earning / summary.impressions) * 1000, "ecpm")
                  : "-"}
              </dd>
            </div>
          </dl>
        </>
      )}

      {/* Sebarisnya saja: berapa subdomain yang angkanya belum utuh. Sebab, jumlah per sebab, dan
          apa yang harus dibuka untuk memperbaikinya pindah ke popover — empat kalimat yang selalu
          tergambar di panel selebar 320px mendorong daftar subdomain (yang justru dicari orang)
          turun setinggi setengah layar, dan setelah dibaca dua kali ia berhenti dibaca. */}
      {summary && summary.incompleteSubDomains > 0 && (
        <p className="calendar-note">
          <AlertTriangle size={14} />
          <span>
            {summary.incompleteSubDomains} dari {summary.subDomains} subdomain belum utuh
          </span>
          <CellPopover badgeClassName="calendar-why" label="Kenapa?" width={280}>
            <strong>Kenapa angkanya belum utuh</strong>
            {incompleteReasons(summary).map((reason) => (
              <span className="calendar-why-row" key={reason.label}>
                <b>
                  {reason.count} {reason.label}
                </b>
                <i>{reason.hint}</i>
              </span>
            ))}
            <em>
              Sisi yang diketahui tetap ikut dijumlahkan — yang dilewati selnya, bukan barisnya.
              Belanja yang tercatat tetap masuk total hari ini walau earning-nya belum ada.
            </em>
          </CellPopover>
        </p>
      )}

      {detail.subDomains.length > 0 && (
        <>
          <h3 className="calendar-subhead">Sub-domain</h3>
          <ol className="calendar-site-list">
            {detail.subDomains.map((item, index) => (
              <li
                key={item.id}
                // Masuk berurutan, dan urutannya adalah urutan belanja: mata mengikuti kemunculan,
                // jadi yang pertama terlihat adalah yang uangnya paling besar. Dijepit di baris
                // kesepuluh — daftar tiga puluh subdomain dengan jeda yang terus bertambah berakhir
                // sebagai antrean yang harus DITUNGGU.
                style={{ animationDelay: `${Math.min(index, 10) * 24}ms` }}
              >
                <div className="calendar-site-head">
                  <strong title={item.subDomain}>{item.subDomain || "-"}</strong>
                  <span
                    className={`calendar-site-roi${
                      item.roi !== "" && item.roi < 0 ? " money-negative" : ""
                    }`}
                  >
                    {formatRoiPercent(item.roi)}
                  </span>
                </div>

                <div className="calendar-site-money">
                  <span className="calendar-out">{money(item.totalSpending)}</span>
                  <span aria-hidden="true">→</span>
                  <span className="calendar-in">{money(item.earning)}</span>
                  {item.profit !== "" && (
                    <span className="calendar-site-profit">{money(item.profit)}</span>
                  )}
                </div>

                {/* Batang proporsi belanja terhadap pembelanja terbesar hari itu. Lebarnya inline
                    karena ia DATA, bukan gaya — warnanya tetap dari kelas, seperti sisa berkas ini.
                    Baris yang spend-nya tidak diketahui tidak menggambar batang sama sekali dan
                    menyebut sebabnya: batang selebar nol adalah klaim bahwa uangnya tidak keluar. */}
                {item.spendingKnown && topSpend > 0 ? (
                  <div className="calendar-site-bar">
                    <span style={{ width: `${(item.totalSpending / topSpend) * 100}%` }} />
                  </div>
                ) : (
                  <MetaSpendNote reason={item.metaMissing} />
                )}

                <span className="calendar-site-pic">{item.pic || "tanpa PIC"}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* Per advertiser hanya kalau memang ada lebih dari satu: daftar satu baris yang isinya sama
          persis dengan total di atasnya cuma menambah judul yang harus dibaca dulu sebelum
          diabaikan. */}
      {detail.advertisers.length > 1 && (
        <>
          <h3 className="calendar-subhead">Per advertiser</h3>
          <ul className="calendar-pic-list">
            {detail.advertisers.map((item) => (
              <li key={item.pic || "-"}>
                <span className="calendar-pic-name">
                  {item.pic || "tanpa PIC"}
                  <small>{item.sites} situs</small>
                </span>
                <span className="calendar-pic-money">
                  {money(item.totalSpending)} <span aria-hidden="true">→</span>{" "}
                  {money(item.earning)}
                </span>
                <span
                  className={`calendar-site-roi${
                    item.roi !== "" && item.roi < 0 ? " money-negative" : ""
                  }`}
                >
                  {formatRoiPercent(item.roi)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {cell.reminders.length > 0 && (
        <>
          <h3 className="calendar-subhead">Jatuh tempo</h3>
          <ul className="calendar-reminders">
            {cell.reminders.map((item) => (
              <li className={item.done ? "done" : ""} key={item.id}>
                <BellRing size={13} />
                <span>{item.title}</span>
                {item.nominal ? <strong>{renderCell(item.nominal, "nominal")}</strong> : null}
                {item.done && <em>selesai</em>}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Pengeluaran operasional hari itu — hanya untuk yang boleh membaca `expenses`. Digambar
          untuk yang lain, ia akan selalu berbunyi Rp 0: store memang tidak melanggan node itu bagi
          mereka, dan nol yang lahir dari izin baca adalah angka yang berbohong tanpa satu pun tanda
          di layar (alasan yang sama menutup halaman Laba Rugi, lihat KEUANGAN_PAGES). */}
      {canReadExpenses && expenses.length > 0 && (
        <>
          <h3 className="calendar-subhead">Pengeluaran tercatat</h3>
          <ul className="calendar-reminders">
            {expenses.map((item) => (
              <li key={item.id}>
                <span>{item.itemName || "-"}</span>
                <strong>{renderCell(item.total ?? item.nominal, "total")}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
