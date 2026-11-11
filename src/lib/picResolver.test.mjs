import assert from "node:assert/strict";
import test from "node:test";
import { resolveRowPic } from "./picResolver.js";

test("resolveRowPic mengosongkan PIC untuk Crissthoper jika baris bertanggal sebelum 1 November 2026", () => {
  const rowOktober = { date: "2026-10-15", pic: "Crissthoper" };
  const res = resolveRowPic(rowOktober, "news.ihopmenuwithprices.us", () => "Crissthoper");
  assert.equal(res, "");

  const rowNovember = { date: "2026-11-02", pic: "Crissthoper" };
  const resNov = resolveRowPic(rowNovember, "news.ihopmenuwithprices.us", () => "Crissthoper");
  assert.equal(resNov, "Crissthoper");
});

test("resolveRowPic mengenali variasi nama Cris atau Crissthoper", () => {
  const rowOktober = { date: "2026-10-31", pic: "Cris" };
  const res = resolveRowPic(rowOktober, "styling.trayedit.com", () => "Cris");
  assert.equal(res, "");
});

test("resolveRowPic mempertahankan PIC lain yang memang aktif di bulan Oktober", () => {
  const rowOktober = { date: "2026-10-15", pic: "Austin" };
  const res = resolveRowPic(rowOktober, "deals.ihopmenuwithprices.us", () => "Austin");
  assert.equal(res, "Austin");
});

test("resolveRowPic memeriksa tanggal join user profil dinamis", () => {
  const users = [
    { name: "UserBaru", created_at: "2026-11-05T00:00:00Z" },
  ];
  const rowOktober = { date: "2026-10-20", pic: "UserBaru" };
  const res = resolveRowPic(rowOktober, "sub.example.com", () => "UserBaru", users);
  assert.equal(res, "");

  const rowNovember = { date: "2026-11-10", pic: "UserBaru" };
  const resNov = resolveRowPic(rowNovember, "sub.example.com", () => "UserBaru", users);
  assert.equal(resNov, "UserBaru");
});

