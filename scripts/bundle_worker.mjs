import fs from 'fs';

const routes = fs.readFileSync('tigerroi-gateway/src/routes.js', 'utf8');
const index = fs.readFileSync('tigerroi-gateway/src/index.js', 'utf8');

// Gabungkan menjadi satu file mandiri
const combined = `// === CLOUDFLARE WORKER: visint-gating (TIGERROI SMART GATEWAY) ===
// Dibuat otomatis untuk disalin langsung ke Editor Cloudflare Workers (visint-gating)

${routes.replace(/export /g, '')}

${index.replace(/import \{ findGatewayRoute \} from ["'].\/routes\.js["'];/, '')}
`;

if (!fs.existsSync('tigerroi-gateway/dist')) fs.mkdirSync('tigerroi-gateway/dist');
fs.writeFileSync('tigerroi-gateway/dist/worker.js', combined);
console.log('Berhasil membuat tigerroi-gateway/dist/worker.js (Ukuran:', combined.length, 'bytes)');
