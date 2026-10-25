// Isi awal tab URL Cloaking di /plugin (`dashboard/cloakingUrls`). Idempotent: URL yang sudah ada
// di daftar (termasuk yang diarsipkan) dilewati. `--dry` cuma menyebutkan yang akan ditulis.

import { get, push, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const IDS = `1BMANBs0_Os sFsap7y8w4Q hMXNP1rvLYA -vhwn4lxzYQ uoJEY4sfEYY gC_cWqVOtu0 52wSf-OHlLA
8fUSnomIrO0 XJy37fX-ydo -gQE8y6z708 OHg0wOoUrFk MfdGIcYL7PU LrcsXts0wF8 k7iXbhRrkJg hOJu598OKWY
UILIp4yzAUY S6alcDGLScg Hn-QVtii81I lgIKFyCNHvc MpzjEwp-8JI 6rXtqDEmvg4 S7u2fTQWfOE hZoNhhTAevY
Og0qq8Zrads vhiAngdbl34 jD1JxvXv8SU AlwnsOmhP1E TP2XI8Aii1U oPyWpHRhi8E 19zb51un4vc Kx2NswznAXA
MbL4f4jFog8 vbqRaATFlPs EptVJ-1o78Q NZ8pDnH3jLU S7gKDXsN1Vw yM7-lw_7Lkw Mo00TevdhxE mPWqnF3ocV0
13XDv_zASh0`.split(/\s+/);
const URLS = IDS.map((id) => `https://www.youtube.com/watch?v=${id}`);

const PATH = "dashboard/cloakingUrls";
const dry = process.argv.includes("--dry");
const db = await connect();

const existing = (await get(ref(db, PATH))).val() || {};
const seen = new Set(Object.values(existing).map((row) => String(row?.url ?? "").trim()));

const now = new Date().toISOString();
const patch = {};
for (const url of URLS) {
  if (seen.has(url)) continue;
  seen.add(url);
  const id = push(ref(db, PATH)).key;
  patch[id] = { url, id, createdAt: now, createdBy: "seed", updatedAt: now, updatedBy: "seed" };
}

const count = Object.keys(patch).length;
console.log(`${URLS.length} URL, ${count} baru${dry ? " (dry, tidak ditulis)" : ""}.`);
if (!dry && count) await update(ref(db, PATH), patch);
process.exit(0);
