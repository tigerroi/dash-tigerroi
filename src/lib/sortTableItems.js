// Sel KOSONG selalu di bawah, di kedua arah — dan itu sebabnya keputusannya diambil di sini,
// bukan di dalam `compareValues`. Sebelumnya "kosong terakhir" ikut dibalik `desc`, jadi seluruh
// baris tanpa nilai naik ke paling atas: pada kolom ROI per Negara — di mana tiga per empat
// barisnya "" sejak lantai belanja `MIN_ROI_SPEND` berlaku — mengklik "ROI %" untuk melihat yang
// tertinggi justru menghasilkan berhalaman-halaman "-", tak terbedakan dari pengurutan yang
// tidak bekerja sama sekali. Yang dicari orang saat mengurutkan sebuah kolom adalah baris yang
// PUNYA nilainya; yang tidak punya bukan nilai terkecil maupun terbesar, ia bukan peserta.
//
// `readValue` untuk kolom yang nilainya DIHITUNG dari baris, bukan satu field (DataTable dengan
// `accessorFn`). Bawaannya `item[key]`, jadi pemanggil lama tidak berubah sedikit pun — dan aturan
// "kosong selalu di bawah" tetap satu tempat, bukan disalin ke pengurut kedua milik library tabel.
export function sortTableItems(items, sort, readValue = defaultReadValue) {
  const rows = Array.isArray(items) ? items : [];

  if (!sort?.key || !sort.direction) {
    return rows;
  }

  return rows
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = normalizeValue(readValue(left.item, sort.key));
      const b = normalizeValue(readValue(right.item, sort.key));

      if (a.type === "empty" || b.type === "empty") {
        // Dua-duanya kosong: urutan asalnya dipertahankan, sama seperti nilai yang seri.
        if (a.type === b.type) {
          return left.index - right.index;
        }

        return a.type === "empty" ? 1 : -1;
      }

      const result = compareValues(a, b);

      if (result === 0) {
        return left.index - right.index;
      }

      return sort.direction === "desc" ? -result : result;
    })
    .map(({ item }) => item);
}

function defaultReadValue(item, key) {
  return item?.[key];
}

// Menerima nilai yang SUDAH dinormalkan, dan tidak pernah bertemu yang kosong — keduanya sudah
// diputuskan di atas.
function compareValues(a, b) {
  if (a.type === b.type && (a.type === "number" || a.type === "date")) {
    return a.value - b.value;
  }

  return a.text.localeCompare(b.text, "id-ID", {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeValue(value) {
  if (value === null || value === undefined || value === "") {
    return { type: "empty", text: "", value: 0 };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { type: "number", text: String(value), value };
  }

  const text = String(value).trim();

  if (!text || text === "-") {
    return { type: "empty", text: "", value: 0 };
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const timestamp = Date.parse(text);

    if (!Number.isNaN(timestamp)) {
      return { type: "date", text, value: timestamp };
    }
  }

  const localDateMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

  if (localDateMatch) {
    const timestamp = new Date(
      Number(localDateMatch[3]),
      Number(localDateMatch[2]) - 1,
      Number(localDateMatch[1]),
    ).getTime();

    if (!Number.isNaN(timestamp)) {
      return { type: "date", text, value: timestamp };
    }
  }

  const numberValue = parseNumberText(text);

  if (numberValue !== null) {
    return { type: "number", text, value: numberValue };
  }

  return { type: "text", text, value: 0 };
}

function parseNumberText(text) {
  const candidate = text.replace(/rp/gi, "").replace(/%/g, "").replace(/\s/g, "").trim();

  if (!/^[+-]?[\d.,]+$/.test(candidate) || !/\d/.test(candidate)) {
    return null;
  }

  const normalized = normalizeNumericSeparators(candidate);
  const value = Number(normalized);

  return Number.isFinite(value) ? value : null;
}

function normalizeNumericSeparators(value) {
  if (value.includes(",")) {
    return value.replace(/\./g, "").replace(",", ".");
  }

  const dotCount = (value.match(/\./g) || []).length;

  if (dotCount > 1) {
    return value.replace(/\./g, "");
  }

  if (dotCount === 1) {
    const [left, right] = value.split(".");

    if (right.length === 3 && left.replace(/[+-]/g, "").length <= 3) {
      return value.replace(".", "");
    }
  }

  return value;
}
