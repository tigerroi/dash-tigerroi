export async function parseImportFile(file, config) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return rows
    .map((row) => mapRowToResource(row, config))
    .filter((item) => Object.values(item).some((value) => String(value).trim() !== ""));
}

function mapRowToResource(row, config) {
  const mapped = {};
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeKey(key), value]);

  for (const field of config.fields) {
    const aliases = new Set([
      normalizeKey(field.name),
      normalizeKey(field.label),
      ...config.columns
        .filter(([key]) => key === field.name)
        .map(([, label]) => normalizeKey(label)),
    ]);

    const match = normalizedEntries.find(([key]) => aliases.has(key));
    mapped[field.name] = match ? String(match[1]).trim() : "";
  }

  if (config.syncField && mapped[config.syncField] === undefined) {
    mapped[config.syncField] = false;
  }

  return mapped;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
