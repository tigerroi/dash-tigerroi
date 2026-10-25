import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Penjaga katalog komponen (README.md di folder ini). Dokumen bisa dilewatkan agent maupun orang;
// tes yang gagal tidak. Tiap aturan menyebut PENGGANTINYA di pesan gagalnya, supaya jalan keluarnya
// langsung terbaca.

const UI_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(UI_DIR, "..", "..");

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(jsx?|mjs)$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

// Komentar dibuang lebih dulu: berkas di repo ini menyebut `<select>` atau `createPortal` di
// komentarnya justru untuk menjelaskan kenapa tidak dipakai.
function withoutComments(text) {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FILES = sourceFiles(SRC_DIR).map((path) => ({
  path: relative(SRC_DIR, path).replace(/\\/g, "/"),
  code: withoutComments(readFileSync(path, "utf8")),
}));

/** Pola yang punya pemilik: hanya berkas `owners` yang boleh memuatnya. */
const OWNED_PATTERNS = [
  {
    name: "createPortal",
    pattern: /\bcreatePortal\(/,
    owners: ["components/ui/Dialog.jsx", "components/ui/DateRangePicker.jsx", "components/ui/MonthRangePicker.jsx"],
    use: "Pakai <Dialog> dari components/ui/Dialog.jsx.",
  },
  {
    name: ".modal-backdrop",
    pattern: /modal-backdrop/,
    owners: ["components/ui/Dialog.jsx", "components/ui/DateRangePicker.jsx", "components/ui/MonthRangePicker.jsx"],
    use: "Pakai <Dialog> dari components/ui/Dialog.jsx.",
  },
  {
    name: "pendengar Escape",
    pattern: /["']Escape["']/,
    owners: ["components/ui/Dialog.jsx", "components/ui/DateRangePicker.jsx", "components/ui/MonthRangePicker.jsx"],
    use: "Pakai <Dialog onClose busy> — Escape sudah ditangani di sana.",
  },
  {
    name: "<table>",
    pattern: /<table[\s>]/,
    owners: ["components/ui/DataTable.jsx"],
    use: "Pakai <DataTable> (varian rupa lewat baseClassName).",
  },
  {
    name: "<select>",
    pattern: /<select[\s>]/,
    owners: [],
    use: "Pakai <SelectField>.",
  },
  {
    name: "import react-select",
    pattern: /from\s+["']react-select/,
    owners: ["components/ui/SelectField.jsx"],
    use: "Pakai <SelectField>.",
  },
  {
    name: 'type="checkbox"',
    pattern: /type=["']checkbox["']/,
    owners: ["components/ui/Switch.jsx", "components/ui/Field.jsx", "components/ui/RowCheckbox.jsx"],
    use: "Pakai <Switch> untuk on/off, <RowCheckbox> untuk memilih baris.",
  },
  {
    name: "navigator.clipboard",
    pattern: /navigator\.clipboard/,
    owners: ["components/ui/CopyButton.jsx"],
    use: "Pakai <CopyButton>.",
  },
  {
    name: 'role="tablist"',
    pattern: /role=["']tablist["']/,
    owners: ["components/ui/TabStrip.jsx"],
    use: "Pakai <TabStrip> (tab di dalam halaman) atau PageTabs (tab = route).",
  },
  {
    name: "empty-panel-message",
    pattern: /empty-panel-message/,
    owners: ["components/ui/EmptyMessage.jsx"],
    use: "Pakai <EmptyMessage>.",
  },
  {
    name: 'label "Segarkan"',
    pattern: /["']Segarkan["']/,
    owners: ["components/ui/RefreshButton.jsx"],
    use: "Pakai <RefreshButton>.",
  },
];

describe("pola yang punya pemilik tidak ditulis ulang", () => {
  for (const rule of OWNED_PATTERNS) {
    test(rule.name, () => {
      const offenders = FILES.filter(
        (file) => rule.pattern.test(file.code) && !rule.owners.includes(file.path),
      ).map((file) => file.path);
      assert.deepEqual(offenders, [], `${rule.name} di luar pemiliknya. ${rule.use}`);
    });
  }

  test("tiap pemilik yang terdaftar masih ada dan masih memuat polanya", () => {
    // Pemilik yang berganti nama atau berhenti memakai polanya membuat daftar ini diam-diam
    // mengizinkan berkas yang tidak ada lagi.
    for (const rule of OWNED_PATTERNS) {
      for (const owner of rule.owners) {
        const file = FILES.find((candidate) => candidate.path === owner);
        assert.ok(file, `${owner} (pemilik ${rule.name}) tidak ada`);
        assert.ok(rule.pattern.test(file.code), `${owner} tidak lagi memuat ${rule.name}`);
      }
    }
  });
});

describe("katalog README.md", () => {
  const readme = readFileSync(join(UI_DIR, "README.md"), "utf8");
  const components = readdirSync(UI_DIR)
    .filter((name) => name.endsWith(".jsx"))
    .map((name) => basename(name, ".jsx"));

  test("tiap komponen di ui/ tercantum", () => {
    const missing = components.filter((name) => !readme.includes(`\`${name}\``));
    assert.deepEqual(
      missing,
      [],
      "Komponen baru di ui/ wajib didaftarkan di README.md (butuh apa → pakai apa → jangan apa).",
    );
  });

  test("tidak ada komponen di katalog yang sudah tidak ada", () => {
    const listed = [...readme.matchAll(/^\| `([A-Za-z]+)`/gm)].map((match) => match[1]);
    const gone = listed.filter((name) => !components.includes(name));
    assert.deepEqual(gone, [], "Katalog menyebut komponen yang sudah tidak ada di ui/.");
  });
});
