import { useMemo, useState } from "react";
import { useUrlState } from "../hooks/useUrlState";
import { monthKeyOf } from "../lib/dateRange";
import { ACCOUNT_TYPES } from "../lib/earningByAccountType";
import { buildTargetRows, targetHistoryRows } from "../lib/targets";
import { DataTable } from "./ui/DataTable";
import { PageHeader } from "./ui/PageHeader";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { moneyColumn } from "./ui/tableColumns";

// Satu domain punya DUA baris tiap bulan (Adsense dan Ad-Exchanger), dan hanya empat kolomnya yang
// diketik orang: Status Terkini, Target, Kendala, Catatan. Payout Sebelumnya, Tercapai, dan Sisa
// Target diturunkan dari baris ROI tiap kali halaman ini digambar — lihat src/lib/targets.js.
export function Targets({ store, navigate, readOnly }) {
  // Bulan berjalan, dihitung tiap render lewat `monthKeyOf` (waktu lokal) — bukan konstanta modul
  // ber-`toISOString`. Dua sebabnya, dan keduanya sudah pernah menggigit di halaman lain:
  // `toISOString` menjawab menurut UTC, jadi antara 00:00-07:00 WIB tanggal 1 halaman ini terbuka
  // di bulan LALU; dan konstanta modul dihitung sekali saat berkasnya dimuat, jadi tab yang
  // menginap melewati pergantian bulan tidak pernah berganti.
  const currentMonth = monthKeyOf(new Date());
  // Bulan yang sedang dilihat ikut ke alamat: baris target dibuka ke halaman edit, dan Back yang
  // mengembalikan bulan berjalan berarti memilih ulang bulan itu tiap kali satu target disunting.
  const [month, setMonth] = useUrlState("bulan", currentMonth);
  // Penyaring jenis akun dan domain, sepola dengan bulan di atasnya: di ALAMAT, bukan di useState.
  // Satu bulan berisi dua baris per domain, jadi armada sepuluh domain sudah berarti dua puluh
  // baris — dan yang dicari orang saat ia membuka halaman ini hampir selalu satu domain atau satu
  // sisi bisnisnya. Kosong = semua, jadi alamat yang belum disaring tetap bersih.
  const [accountType, setAccountType] = useUrlState("jenis", "");
  const [domain, setDomain] = useUrlState("domain", "");
  const [selected, setSelected] = useState(null); // { domainId, domain, accountType }

  const allRows = useMemo(() => buildTargetRows(store, month), [store, month]);
  const rows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          (!accountType || row.accountType === accountType) && (!domain || row.domain === domain),
      ),
    [allRows, accountType, domain],
  );
  const historyRows = useMemo(
    () => (selected ? targetHistoryRows(store, selected.domainId, selected.accountType) : []),
    [store, selected],
  );

  // Pilihan domain diambil dari baris yang BENAR-BENAR bisa muncul di tabel, bukan dari
  // `store.domains` langsung: keduanya hampir selalu sama, dan pada hari mereka berbeda yang
  // ditawarkan dropdown ini adalah domain yang tidak akan pernah punya baris untuk dipilih.
  const domainOptions = useMemo(
    () => [...new Set(allRows.map((row) => row.domain).filter(Boolean))].sort(),
    [allRows],
  );

  const filtered = Boolean(accountType || domain);

  return (
    <div className="page-stack">
      <PageHeader
        title="Target Earning"
        description="Target earning bulanan per domain dan jenis akun, berikut realisasinya."
        action={
          <div className="header-actions">
            <input
              aria-label="Pilih bulan target"
              className="control compact-control"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <SelectField
              ariaLabel="Saring menurut jenis akun"
              className="compact-control"
              value={accountType}
              onChange={setAccountType}
              options={[
                { value: "", label: "Semua jenis" },
                ...toSelectOptions(withCurrent(ACCOUNT_TYPES, accountType)),
              ]}
            />
            <SelectField
              ariaLabel="Saring menurut domain"
              className="compact-control"
              value={domain}
              onChange={setDomain}
              options={[
                { value: "", label: "Semua domain" },
                ...toSelectOptions(withCurrent(domainOptions, domain)),
              ]}
            />
            {!readOnly && (
              <button
                className="primary-button"
                type="button"
                onClick={() => navigate("/targets/new")}
              >
                Tambah Target
              </button>
            )}
          </div>
        }
      />

      <DataTable
        columns={[
          {
            accessorKey: "domain",
            header: "Domain",
            cell: ({ row }) => (
              <button
                className="table-link-button"
                type="button"
                onClick={() =>
                  setSelected({
                    domainId: row.original.domainId,
                    domain: row.original.domain,
                    accountType: row.original.accountType,
                  })
                }
              >
                {row.original.domain}
              </button>
            ),
          },
          ["accountType", "Jenis"],
          ...targetMoneyColumns,
          ["kendala", "Kendala"],
          ["catatan", "Catatan"],
        ]}
        emptyText={filtered ? "Tidak ada baris yang cocok dengan filter." : "Tidak ada domain."}
        extraAction={
          readOnly
            ? undefined
            : (row) => (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => navigate(`/targets/${row.domainId}/${month}/${row.slug}/edit`)}
                >
                  Atur
                </button>
              )
        }
        items={rows}
      />

      {selected && (
        <div className="page-stack">
          <div className="panel-header">
            <div>
              <h2>
                Riwayat — {selected.domain} ({selected.accountType})
              </h2>
              <p>Target vs realisasi tiap bulan.</p>
            </div>
            <div className="header-actions">
              <button className="ghost-button" type="button" onClick={() => setSelected(null)}>
                Tutup
              </button>
            </div>
          </div>
          <DataTable
            columns={[["month", "Bulan"], ...targetMoneyColumns]}
            emptyText="Belum ada target atau realisasi."
            getRowId={(row) => row.month}
            items={historyRows}
          />
        </div>
      )}
    </div>
  );
}

// Kolom yang sama di tabel bulan ini dan panel Riwayat: dua daftar untuk satu arti akan berbeda
// suatu hari. Kolom Bulan di Riwayat berbunyi "Agu 2026" lewat `renderCell` (bentuk `YYYY-MM`).
const targetMoneyColumns = [
  ["status", "Status Terkini"],
  moneyColumn("previousPayout", "Payout Sebelumnya", "earning"),
  moneyColumn("target", "Target", "earning"),
  moneyColumn("realized", "Tercapai", "earning"),
  // `profit` dan bukan `earning`: kolom ini satu-satunya di tabel yang boleh minus, dan minus di
  // sini adalah kabar yang menuntut tindakan.
  moneyColumn("remaining", "Sisa Target", "profit"),
];

// Nilai yang sedang menyaring tapi tidak ada di daftar pilihan — domain yang dihapus, atau `?jenis=`
// yang diketik tangan — tetap digambar sebagai pilihan. Tanpa ini, select-nya tampil KOSONG di atas
// tabel yang juga kosong: satu-satunya keterangan tentang apa yang sedang menyaring justru hilang
// persis saat ia paling dibutuhkan.
function withCurrent(options, value) {
  return value && !options.includes(value) ? [...options, value] : options;
}
