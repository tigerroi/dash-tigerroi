import fs from "node:fs";

const master = JSON.parse(fs.readFileSync("tigerroi-gateway/src/keitaro-master.json", "utf8"));

const rows = master.map((item, idx) => {
  return {
    id: item.code,
    campaignId: String(100 + idx + 1),
    code: item.code,
    name: `${item.target} (${item.code})`,
    alias: item.alias,
    state: "active",
    gated: true,
    gatedLabel: "Lewat gate",
    landingUrl: `https://${item.target}/`,
    landingHost: item.target,
    decoyUrl: "https://youtu.be/3DdYl026Z6k",
    decoyHost: "youtu.be",
    keitaroUrl: item.keitaroUrl,
    preview: { applicable: true, current: "https://visint-gating.tiger-roiunlimited.workers.dev", willSet: `https://${item.target}/` },
    blockers: [],
    command: null,
  };
});

const content = `/**
 * Data Master 50 Campaign Keitaro Tracker Resmi TigerROI Mas Def
 * Sumber: https://appscity.tech/admin (50 Kampanye)
 */

export const MASTER_KEITARO_CAMPAIGNS = ${JSON.stringify(rows, null, 2)};
`;

fs.writeFileSync("src/lib/keitaroMaster.js", content);
console.log(`Generated src/lib/keitaroMaster.js with ${rows.length} campaigns.`);
