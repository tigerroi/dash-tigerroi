import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { parseCloakingUrls } from "../../lib/cloakingUrls";
import { notifyWarning } from "../../lib/notify";
import { CopyButton } from "../ui/CopyButton";
import { DataTable } from "../ui/DataTable";

/**
 * Daftar URL cloaking yang dipakai landing "Buat dari preset": server kontrol memilih SATU secara
 * acak untuk tiap landing yang baru lahir. Daftar kosong = landing lahir tanpa URL cloaking, persis
 * seperti sebelum tab ini ada.
 */
export function CloakingUrls({ items = [], canManage, onAdd, onRemove }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => items.filter((row) => row?.url && !row.deletedAt), [items]);

  const add = async () => {
    const { fresh, invalid } = parseCloakingUrls(text, rows);
    if (invalid.length) {
      notifyWarning(`Bukan URL http(s), tidak disimpan: ${invalid.join(", ")}`);
    }
    if (!fresh.length) {
      if (!invalid.length) notifyWarning("Tidak ada URL baru — semuanya sudah ada di daftar.");
      return;
    }
    setSaving(true);
    if (await onAdd(fresh)) setText("");
    setSaving(false);
  };

  return (
    <section className="panel">
      {canManage && (
        <div className="field plugin-field-wide">
          <label htmlFor="cloaking-urls-input">Tambah URL (satu per baris)</label>
          <textarea
            className="control plugin-textarea"
            disabled={saving}
            id="cloaking-urls-input"
            onChange={(event) => setText(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            rows={5}
            spellCheck={false}
            value={text}
          />
          <div className="plugin-actions-buttons">
            <button
              className="primary-button"
              disabled={saving || !text.trim()}
              onClick={add}
              type="button"
            >
              {saving ? "Menyimpan..." : "Tambah"}
            </button>
          </div>
        </div>
      )}

      <p className="muted-line">
        {rows.length} URL. Tiap landing "Buat dari preset" memakai satu URL acak dari daftar ini.
      </p>

      <DataTable
        columns={[
          {
            accessorKey: "url",
            header: "URL",
            cell: ({ row }) => (
              <a href={row.original.url} rel="noreferrer" target="_blank">
                {row.original.url}
              </a>
            ),
          },
          ["createdAt", "Ditambahkan"],
          {
            id: "actions",
            header: "Aksi",
            enableSorting: false,
            cell: ({ row }) => (
              <span className="plugin-actions-buttons">
                <CopyButton label="Salin URL" text={row.original.url} />
                {canManage && (
                  <button
                    aria-label={`Hapus ${row.original.url}`}
                    className="ghost-button icon-button"
                    onClick={() => onRemove(row.original.id)}
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </span>
            ),
          },
        ]}
        getRowId={(row) => String(row.id)}
        items={rows}
      />
    </section>
  );
}
