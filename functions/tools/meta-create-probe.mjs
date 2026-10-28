// Pembuktian jalur "Buat campaign" ke Meta produksi, lewat fungsi dan payload yang SAMA dengan
// server — bukan parameter yang ditulis tangan. Yang diuji: campaign (CBO, PAUSED), satu ad set
// (dynamic creative + pixel), satu creative, satu iklan.
//
//   cd functions
//   node --env-file-if-exists=.env.sync tools/meta-create-probe.mjs <act_id> <pixel_id> <page_id> <image_hash>
//   ... --run      # MENULIS ke Meta (semuanya PAUSED)
//   ... --cleanup <campaign_id>
//
// Jalankan hanya setelah pemilik akun iklan menyetujuinya. Tanpa --run ia cuma mencetak payload.
import {
  adPayload,
  adSetPayload,
  campaignPayload,
  createPlan,
  creativePayload,
} from "../campaign-create-core.js";
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  META_MINOR_UNIT,
} from "../meta.js";

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN belum di-set.");
  process.exit(1);
}
const print = (label, value) =>
  console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);
const args = process.argv.slice(2);

if (args[0] === "--cleanup") {
  const id = args[1];
  if (!/^\d+$/.test(id || "")) {
    console.error("ID campaign harus angka.");
    process.exit(1);
  }
  const body = new URLSearchParams({ status: "DELETED", access_token: token });
  const res = await fetch(`https://graph.facebook.com/v25.0/${id}`, { method: "POST", body });
  print("hapus campaign uji", await res.json());
  process.exit(0);
}

const [actId, pixelId, pageId, imageA, imageB] = args.filter((arg) => !arg.startsWith("--"));
if (!actId || !pixelId || !pageId || !imageA || !imageB) {
  console.error(
    "Pakai: meta-create-probe.mjs <act_id> <pixel_id> <page_id> <hash1> <hash2> [--run]",
  );
  process.exit(1);
}

// Kode/link uji tidak dibaca dari RTDB: yang dibuktikan di sini bentuk permintaannya, dan vonis nama
// sudah punya tesnya sendiri. `byCode` dibuat seadanya supaya `createPlan` melewati vonisnya.
const byCode = new Map([["uji", "uji.probe.local"]]);
const plan = createPlan({
  name: "uji-01 RabbitROI probe (hapus)",
  subDomain: "uji.probe.local",
  link: "https://rabbitracing.live/probeuji?bit=[race]",
  dailyBudget: 20000,
  countries: ["ID"],
  pageId,
  pixelId,
  images: [imageA, imageB],
  cta: "LEARN_MORE",
  variants: [{ title: "Uji create ads", body: "Jangan tayangkan — ini uji dashboard." }],
  byCode: new Map([...byCode, ["uji", "uji.probe.local"]]),
});

print("payload campaign", campaignPayload(plan, META_MINOR_UNIT));
print("payload ad set", adSetPayload(plan, { name: plan.names[0], campaignId: "<menyusul>" }));
print(
  "payload creative",
  creativePayload(plan, { name: plan.names[0], variant: plan.variants[0] }),
);

if (!args.includes("--run")) {
  console.log("\nMode baca saja. Tambahkan --run untuk benar-benar membuat (semuanya PAUSED).");
  process.exit(0);
}

const born = { campaignId: "", adSetId: "", creativeId: "", adId: "" };
const step = async (label, task) => {
  try {
    const id = await task();
    console.log(`[OK] ${label}: ${id}`);
    return id;
  } catch (error) {
    console.log(`[GAGAL] ${label}: ${error.message}`);
    return "";
  }
};

born.campaignId = await step("campaign", () =>
  createCampaign(actId, token, campaignPayload(plan, META_MINOR_UNIT)),
);
if (born.campaignId) {
  born.adSetId = await step("ad set", () =>
    createAdSet(
      actId,
      token,
      adSetPayload(plan, { name: plan.names[0], campaignId: born.campaignId }),
    ),
  );
}
born.creativeId = await step("creative", () =>
  createAdCreative(
    actId,
    token,
    creativePayload(plan, { name: plan.names[0], variant: plan.variants[0] }),
  ),
);
if (born.adSetId && born.creativeId) {
  born.adId = await step("iklan", () =>
    createAd(
      actId,
      token,
      adPayload({ name: plan.names[0], adSetId: born.adSetId, creativeId: born.creativeId }),
    ),
  );
}
print("yang lahir", born);
if (born.campaignId) console.log(`\nBersihkan: --cleanup ${born.campaignId}`);
process.exit(0);
