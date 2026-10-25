import assert from "node:assert/strict";
import test from "node:test";
import { subDomainRoiSeries } from "./subDomainRoiSeries.js";

// Nominalnya di atas MIN_ROI_SPEND (lib/adTax.js): di bawah lantai itu ROI-nya "" dan deretnya
// memang tidak digambar — yang diuji di sini bentuk deretnya, bukan lantainya.
const rows = [
  { date: "2026-08-22", time: "14:07", subDomain: "trends.a.com", spending: 100_000, earning: 400_000 },
  { date: "2026-08-22", time: "15:07", subDomain: "trends.a.com", spending: 200_000, earning: 900_000 },
  { date: "2026-08-22", time: "15:07", subDomain: "shoes.a.com", spending: 1_000_000, earning: 2_000_000 },
];

test("satu deret per subdomain, dengan kunci yang bukan namanya", () => {
  const { series, points } = subDomainRoiSeries(rows, 0);

  assert.deepEqual(
    series.map((item) => [item.key, item.name, item.label]),
    [
      ["s0", "shoes.a.com", "shoes"],
      ["s1", "trends.a.com", "trends"],
    ],
  );
  // Titik di dalam nama subdomain dibaca recharts sebagai jalur objek; kuncinya karena itu s0/s1.
  assert.ok(series.every((item) => !item.key.includes(".")));
  assert.deepEqual(
    points.map((point) => point.time),
    ["14:07", "15:07"],
  );
});

test("sync yang belum membawa subdomain itu memutus garisnya, bukan menariknya ke nol", () => {
  const { points } = subDomainRoiSeries(rows, 0);

  assert.equal(points[0].s0, null);
  assert.equal(points[0].s1, 300);
});

test("ROI yang tidak diketahui dilewati, bukan digambar sebagai 0", () => {
  const { series, points } = subDomainRoiSeries(
    [
      // Tanpa spend sama sekali: subdomain yang tidak diiklankan di Meta.
      { date: "2026-08-22", time: "14:07", subDomain: "gam.a.com", earning: 400_000 },
      ...rows,
    ],
    0,
  );

  assert.ok(!series.some((item) => item.name === "gam.a.com"));
  assert.ok(points.every((point) => point.s0 !== 0));
});

test("ad tax ikut menaikkan penyebut ROI, sama dengan tabel", () => {
  const { bars } = subDomainRoiSeries(
    [
      {
        date: "2026-08-22",
        time: "14:07",
        subDomain: "trends.a.com",
        spending: 100_000,
        earning: 400_000,
      },
    ],
    0.05,
  );

  // (400.000 − 105.000) / 105.000
  assert.equal(bars[0].totalSpend, 105_000);
  assert.equal(Math.round(bars[0].roi), 281);
});

test("batangnya dari bacaan TERAKHIR tiap subdomain, bukan dari stempel terakhir tabel", () => {
  const { bars, latestStamp } = subDomainRoiSeries(
    [
      ...rows,
      {
        date: "2026-08-22",
        time: "16:07",
        subDomain: "trends.a.com",
        spending: 300_000,
        earning: 600_000,
      },
    ],
    0,
  );

  assert.equal(latestStamp, "2026-08-22 16:07");
  // Shoes tertinggal satu sync dan tetap muncul, dengan jam bacaannya sendiri.
  assert.deepEqual(
    bars.map((item) => [item.label, item.time]),
    [
      ["shoes", "15:07"],
      ["trends", "16:07"],
    ],
  );
});

test("tanggal ikut disebut hanya saat rentangnya lebih dari sehari", () => {
  assert.equal(subDomainRoiSeries(rows, 0).multiDay, false);
  assert.equal(
    subDomainRoiSeries(
      [
        ...rows,
        {
          date: "2026-08-21",
          time: "14:07",
          subDomain: "shoes.a.com",
          spending: 10_000,
          earning: 20_000,
        },
      ],
      0,
    ).multiDay,
    true,
  );
});
