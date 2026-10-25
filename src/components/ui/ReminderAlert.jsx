import { BellRing, Check } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../../lib/formatDate";
import { dueReminders, expenseFromReminder, isRepeating, nextDueDate } from "../../lib/reminders";
import { renderCell } from "../../lib/renderCell";
import { Dialog } from "./Dialog";
import { Switch } from "./Switch";

// Ikon pengingat di topbar: muncul hanya kalau ada reminder yang jatuh tempo/terlewat dan belum
// selesai. Diklik → dialog rinciannya, dan tiap baris bisa langsung ditandai selesai dari situ
// tanpa membuka halaman /reminders. Angkanya dari `dueReminders` yang sama dengan panel Overview,
// jadi badge dan daftar tidak pernah berbeda. Padam = tidak ada yang menunggu, bukan sekadar
// sudah dibaca.
//
// Dilihat SELURUH tim, bukan hanya Keuangan — pengingat perpanjangan domain yang cuma terlihat
// satu role tidak menahan siapa pun selain role itu. `canComplete` memisahkan melihat dari
// mengubah: yang menandai selesai tetap admin + Keuangan (canWrite), dan tombol yang digambar
// untuk role lain hanya akan ditolak aturan database setelah diklik.
export function ReminderAlert({
  reminders,
  onComplete,
  navigate,
  canComplete = false,
  canRecordExpense = false,
}) {
  const [open, setOpen] = useState(false);
  // Yang disimpan adalah baris yang DIKECUALIKAN, bukan yang dipilih. Bawaannya mencatat: reminder
  // tipe Pembayaran yang bernominal memang pengeluaran, dan orang yang harus mencentang sesuatu
  // dulu tiap kali akan berhenti mencentangnya — lalu Laba Rugi kehilangan justru pengeluaran yang
  // rutin. Yang tidak ingin dicatat (sudah diinput manual, dibayar orang lain) melepasnya di sini.
  const [skipped, setSkipped] = useState(() => new Set());
  const due = dueReminders(reminders);

  const toggleSkip = (id) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (due.length === 0) {
    return null;
  }

  return (
    <>
      <button
        className="sync-alert reminder-alert"
        onClick={() => setOpen(true)}
        title="Ada pengingat yang jatuh tempo. Klik untuk rinciannya."
        type="button"
      >
        <BellRing size={15} />
        <span>{due.length} pengingat</span>
      </button>

      {/* Portal ke <body>, alasan sama dengan SyncIssuesAlert: `.topbar` memakai backdrop-filter,
          jadi elemen fixed di dalamnya akan terpotong di tepi header. */}
      {open && (
        <Dialog
          className="sync-issues-dialog"
          headClassName="sync-issues-head"
          onClose={() => setOpen(false)}
          subtitle={
            <>
              Belum selesai dan jatuh tempo dalam 2 hari ke depan atau terlewat.
              {canComplete
                ? " Tandai selesai bila sudah; yang berulang dimajukan ke jatuh tempo berikutnya."
                : " Yang menandai selesai admin & keuangan."}
              {canComplete && canRecordExpense
                ? " Yang bertipe Pembayaran sekalian dicatat sebagai pengeluaran."
                : ""}
            </>
          }
          title="Pengingat jatuh tempo"
        >
          <div className="sync-issues-body">
            <ul className="reminder-due-list">
              {due.map((row) => (
                <li className="reminder-due-item" key={row.id}>
                  <span className="reminder-due-title">{row.title}</span>
                  {row.type && <span className="badge">{row.type}</span>}
                  <span className="reminder-due-date">{formatDate(row.dueDate)}</span>
                  {/* Baris berulang menyebutkan dirinya. Tanpa ini, tombol centangnya terbaca
                      seperti tombol yang sama dengan baris lain — padahal yang ini tidak
                      menyelesaikan apa pun, ia memajukan tanggalnya. */}
                  {isRepeating(row) && <span className="badge">{row.repeat}</span>}
                  {row.nominal ? (
                    <span className="reminder-due-amount">
                      {renderCell(row.nominal, "nominal")}
                    </span>
                  ) : null}
                  {/* Cuma untuk baris yang benar-benar akan menghasilkan pengeluaran —
                      `expenseFromReminder` yang memutuskan, bukan tipe-nya saja: reminder
                      Pembayaran tanpa nominal tidak punya angka untuk dicatat, dan kotak
                      tercentang yang tidak menulis apa pun adalah janji yang tidak ditepati. */}
                  {canComplete && canRecordExpense && expenseFromReminder(row) && (
                    <Switch
                      checked={!skipped.has(row.id)}
                      className="reminder-due-expense"
                      label="Catat ke Expenses"
                      onChange={() => toggleSkip(row.id)}
                      title={expenseHint(row)}
                    />
                  )}
                  {canComplete && (
                    <button
                      className="ghost-button icon-button"
                      onClick={() =>
                        onComplete(row.id, {
                          recordExpense: canRecordExpense && !skipped.has(row.id),
                        })
                      }
                      title={completeHint(row)}
                      type="button"
                    >
                      <Check size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {/* Sejak Reminder jadi tab di bawah "Target & Reminder", jalur tercepat menuju
                daftar penuhnya adalah dari sini — dialog ini yang dibuka orang saat teringat
                ada yang jatuh tempo. */}
            {navigate && (
              <button
                className="ghost-button"
                onClick={() => {
                  setOpen(false);
                  navigate("/reminders");
                }}
                type="button"
              >
                Lihat semua pengingat
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

// Bunyi tooltip tombol centang. Untuk baris berulang ia menyebutkan TANGGAL tujuannya, bukan cuma
// bahwa ia berulang: yang menekan tombol ini sedang memutuskan sesuatu, dan tanggal yang muncul
// setelahnya tidak boleh jadi kejutan.
function completeHint(row) {
  if (!isRepeating(row)) return "Tandai selesai";

  const next = nextDueDate(row.dueDate, row.repeat, row.repeatEvery);
  return next ? `Tandai selesai — maju ke ${formatDate(next)}` : "Tandai selesai";
}

// Kotak "Catat ke Expenses" menyebutkan tanggal yang akan tertulis, bukan cuma bahwa ia mencatat.
// Yang tertulis adalah HARI INI (arus kas), bukan jatuh temponya — dan tagihan bulan lalu yang baru
// dibayar hari ini akan muncul di Laba Rugi bulan ini. Itu benar, tapi tidak boleh jadi kejutan.
function expenseHint(row) {
  const expense = expenseFromReminder(row);
  if (!expense) return "";

  return `Tulis satu baris pengeluaran bertanggal ${formatDate(expense.values.date)}`;
}
