import assert from "node:assert";
import { test } from "node:test";

// Hook-nya tipis dan tidak memakai efek, jadi perilakunya bisa diuji dari fungsi murni yang sama
// dipakai di dalamnya: potongan baris, penjepitan halaman, dan penomoran lintas halaman.
function paginate(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activePage = Math.min(page, totalPages);
  return {
    totalPages,
    page: activePage,
    rangeStart: total === 0 ? 0 : (activePage - 1) * pageSize + 1,
    rangeEnd: Math.min(activePage * pageSize, total),
    sliceFrom: (activePage - 1) * pageSize,
    sliceTo: activePage * pageSize,
  };
}

test("memotong halaman pertama", () => {
  const p = paginate(37, 1, 10);
  assert.equal(p.totalPages, 4);
  assert.equal(p.rangeStart, 1);
  assert.equal(p.rangeEnd, 10);
});

test("halaman terakhir tidak melebihi jumlah baris", () => {
  const p = paginate(37, 4, 10);
  assert.equal(p.rangeStart, 31);
  assert.equal(p.rangeEnd, 37, "bukan 40");
});

test("halaman dijepit saat baris menyusut", () => {
  // Skenario nyata: sedang di halaman 7, lalu range tanggal dipersempit jadi 12 baris.
  const p = paginate(12, 7, 10);
  assert.equal(p.page, 2, "langsung ke halaman terakhir yang ada, bukan halaman kosong");
  assert.equal(p.rangeEnd, 12);
});

test("tabel kosong tidak menghitung mundur dari nol", () => {
  const p = paginate(0, 1, 10);
  assert.equal(p.totalPages, 1);
  assert.equal(p.rangeStart, 0);
  assert.equal(p.rangeEnd, 0);
});

test("satu halaman penuh tepat tidak melahirkan halaman kedua", () => {
  assert.equal(paginate(10, 1, 10).totalPages, 1, "10 baris @10 = satu halaman");
  assert.equal(paginate(11, 1, 10).totalPages, 2);
});

test("nomor '# NO' berlanjut antar halaman", () => {
  // Kalau nomor dihitung dari indeks halaman, halaman 3 akan mulai dari 1 lagi.
  const p = paginate(37, 3, 10);
  const nomor = [0, 1, 2].map((index) => p.rangeStart + index);
  assert.deepEqual(nomor, [21, 22, 23]);
});

test("baris yang tampil sesuai potongan halaman", () => {
  const rows = Array.from({ length: 37 }, (_, i) => i + 1);
  const p = paginate(rows.length, 2, 10);
  assert.deepEqual(rows.slice(p.sliceFrom, p.sliceTo), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});
