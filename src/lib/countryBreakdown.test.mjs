import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCountryBreakdown,
  buildCountryBreakdownFromRows,
  countriesOf,
} from "./countryBreakdown.js";

const users = [
  {
    name: "Rina",
    // Bentuk apa adanya dari RTDB: object berkunci `subdomain__negara`, bukan array.
    countryRoi: {
      "trends-stylefemale-com__ID": {
        date: "2026-08-09",
        subDomain: "trends.stylefemale.com",
        country: "Indonesia",
        isoCode: "ID",
        spending: 100000,
        earning: 400000,
      },
      "trends-stylefemale-com__TR": {
        date: "2026-08-09",
        subDomain: "trends.stylefemale.com",
        country: "Turki",
        isoCode: "TR",
        spending: 900000,
        earning: 300000,
      },
    },
  },
];

describe("countryBreakdown", () => {
  test("baris ROI dijodohkan dengan negaranya lewat hari + subdomain", () => {
    const index = buildCountryBreakdown(users, 0.05);
    const rows = countriesOf(index, { date: "2026-08-09", subDomain: "trends.stylefemale.com" });

    assert.equal(rows.length, 2);
    // Spend terbesar dulu — negara yang paling banyak menghabiskan uang yang pertama dicari.
    assert.deepEqual(
      rows.map((row) => row.countryLabel),
      ["Turki (TR)", "Indonesia (ID)"],
    );
  });

  test("tiap baris membawa id yang unik lintas user", () => {
    const index = buildCountryBreakdown(
      [
        { id: "u1", countryRoi: { "a-com__ID": { date: "2026-08-09", subDomain: "a.com" } } },
        { id: "u2", countryRoi: { "a-com__ID": { date: "2026-08-09", subDomain: "a.com" } } },
      ],
      0.05,
    );
    const ids = countriesOf(index, { date: "2026-08-09", subDomain: "a.com" }).map((r) => r.id);

    assert.deepEqual(ids, ["u1__a-com__ID", "u2__a-com__ID"]);
    assert.equal(new Set(ids).size, 2, "key React yang kembar menghilangkan salah satu barisnya");
  });

  test("uangnya lewat rumus yang sama dengan panel ROI per Negara", () => {
    const [turki] = countriesOf(buildCountryBreakdown(users, 0.05), {
      date: "2026-08-09",
      subDomain: "trends.stylefemale.com",
    });

    assert.equal(turki.adTax, 45000, "900.000 × 5%");
    assert.equal(turki.totalSpending, 945000);
    assert.equal(turki.roi, -68.25, "(300.000 − 945.000) / 945.000");
  });

  test("nama subdomain dijodohkan tanpa peduli huruf besar/kecil dan spasi", () => {
    const index = buildCountryBreakdown(users, 0.05);
    assert.equal(
      countriesOf(index, { date: "2026-08-09", subDomain: " Trends.StyleFemale.com " }).length,
      2,
    );
  });

  test("stempel waktu penuh pada tanggal tetap terbaca sebagai harinya", () => {
    const index = buildCountryBreakdown(users, 0.05);
    assert.equal(
      countriesOf(index, {
        date: "2026-08-09T17:00:00.000Z",
        subDomain: "trends.stylefemale.com",
      }).length,
      2,
    );
  });

  test("hari tanpa rincian negara mengembalikan daftar kosong, bukan undefined", () => {
    const index = buildCountryBreakdown(users, 0.05);
    assert.deepEqual(
      countriesOf(index, { date: "2026-08-01", subDomain: "trends.stylefemale.com" }),
      [],
    );
    assert.deepEqual(countriesOf(index, {}), []);
    assert.deepEqual(countriesOf(undefined, { date: "2026-08-09", subDomain: "a.com" }), []);
  });

  test("dua user yang memegang subdomain yang sama tidak saling menimpa", () => {
    const index = buildCountryBreakdown(
      [
        users[0],
        {
          name: "Budi",
          countryRoi: [
            {
              date: "2026-08-09",
              subDomain: "trends.stylefemale.com",
              country: "Mesir",
              isoCode: "EG",
              spending: 5000,
              earning: 1000,
            },
          ],
        },
      ],
      0.05,
    );

    assert.equal(
      countriesOf(index, { date: "2026-08-09", subDomain: "trends.stylefemale.com" }).length,
      3,
    );
  });

  test("user tanpa countryRoi dilewati tanpa melempar", () => {
    assert.equal(buildCountryBreakdown([{ name: "Kosong" }, null], 0.05).size, 0);
    assert.equal(buildCountryBreakdown(undefined, 0.05).size, 0);
  });

  test("buildCountryBreakdownFromRows membaca baris tabel Supabase country_roi dengan benar", () => {
    const supabaseRows = [
      {
        id: "cr-1",
        date: "2026-10-23",
        sub_domain: "insurance.tiktokmodapk.net",
        country_code: "IT",
        country_name: "Italia",
        spend: 159836,
        impressions: 4460,
        clicks: 3508,
        cpc: 45.56,
        earning: 796925,
        profit: 629097,
        roi: 374.85,
      },
      {
        id: "cr-2",
        date: "2026-10-23",
        sub_domain: "insurance.tiktokmodapk.net",
        country_code: "RO",
        country_name: "Romania",
        spend: 59504,
        impressions: 2324,
        clicks: 1911,
        cpc: 31.14,
        earning: 283520,
        profit: 221041,
        roi: 353.78,
      },
    ];

    const index = buildCountryBreakdownFromRows(supabaseRows, 0.05);
    const rows = countriesOf(index, {
      date: "2026-10-23",
      subDomain: "insurance.tiktokmodapk.net",
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].countryLabel, "Italia (IT)");
    assert.equal(rows[0].spending, 159836);
    assert.equal(rows[0].adTax, 7991.8);
    assert.equal(rows[0].totalSpending, 167827.8);
    assert.equal(rows[0].earning, 796925);
    assert.equal(rows[0].roi, 374.85);

    assert.equal(rows[1].countryLabel, "Romania (RO)");
  });
});
