import { formatRoiPercent, roiCellClass } from "../../lib/adTax";
import { renderCell } from "../../lib/renderCell";

/**
 * Pembuat definisi kolom `DataTable` untuk bentuk yang berulang di halaman laporan: uang, ROI, dan
 * persen tarif. Yang dikumpulkan di sini bukan singkatannya melainkan ATURANNYA — kolom ROI yang
 * lupa warna merahnya, atau kolom uang yang lupa `renderKey`-nya (yang menentukan hijau/merah dan
 * "-" untuk yang tidak diketahui), tidak berbunyi sebagai kesalahan di mana pun.
 *
 * `options.total` diisi NILAI baris Total (bukan fungsi), dan dirender dengan aturan yang sama
 * persis dengan selnya. `undefined` = kolom ini tidak punya baris Total; `null`/"" = digambar "-".
 */

export function moneyColumn(key, header, renderKey = key, options = {}) {
  return {
    accessorKey: key,
    header,
    cell: ({ row }) => (
      <>
        {renderCell(row.original[key], renderKey)}
        {options.note?.(row.original)}
      </>
    ),
    ...footerOf(options, (value) => renderCell(value, renderKey)),
    meta: { align: "right", hint: options.hint },
  };
}

export function roiColumn(key, header, options = {}) {
  return {
    accessorKey: key,
    header,
    cell: ({ getValue }) => (options.format || formatRoiPercent)(getValue()),
    ...footerOf(options, (value) => (options.format || formatRoiPercent)(value)),
    meta: {
      align: "right",
      hint: options.hint,
      className: (item) => roiCellClass(item[key]),
      footerClassName: options.total === undefined ? undefined : roiCellClass(options.total),
    },
  };
}

// Tarif yang KOSONG bukan 0%: yang pertama berarti belum diisi, yang kedua pernyataan.
export function formatPercent(value) {
  return value === null || value === undefined || value === "" ? "-" : `${value}%`;
}

function footerOf(options, render) {
  if (options.total === undefined) {
    return {};
  }
  return { footer: () => render(options.total) };
}
