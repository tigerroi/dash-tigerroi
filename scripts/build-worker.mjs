import fs from "node:fs";

let routes = fs.readFileSync("tigerroi-gateway/src/routes.js", "utf8");
routes = routes.replace("export const GATEWAY_ROUTES =", "const GATEWAY_ROUTES =");
routes = routes.replace("export function findGatewayRoute", "function findGatewayRoute");

let index = fs.readFileSync("tigerroi-gateway/src/index.js", "utf8");
index = index.replace(/import\s+\{[^}]+\}\s+from\s+["'].\/routes\.js["'];?/, "");

const header = `// === CLOUDFLARE WORKER: visint-gating (TIGERROI SMART GATEWAY) ===
// Versi: 1.4.0 (Dukungan Fleksibel: Sebelum Keitaro & Setelah Keitaro + Bot Trap YouTube)
// Dibuat otomatis untuk disalin langsung ke Editor Cloudflare Workers (visint-gating)

`;

fs.writeFileSync("tigerroi-gateway/dist/worker.js", header + routes + "\n\n" + index);
console.log("Worker bundle updated successfully!");
