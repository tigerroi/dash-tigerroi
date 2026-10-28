import { importPKCS8, SignJWT } from "jose";

/**
 * Klien Google Ad Manager (GAM) v1 REST API menggunakan Service Account JSON.
 * Scope: https://www.googleapis.com/auth/admanager
 */

const GAM_BASE = "https://admanager.googleapis.com/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Menghasilkan Google OAuth2 Access Token menggunakan private key Service Account.
 */
export async function getGoogleServiceAccountToken({ clientEmail, privateKey }) {
  if (!clientEmail || !privateKey) {
    throw new Error("clientEmail dan privateKey Service Account wajib diisi.");
  }

  // Format private key PKCS8
  const formattedKey = privateKey.replace(/\\n/g, "\n");
  const parsedKey = await importPKCS8(formattedKey, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/admanager",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600) // 1 jam
    .sign(parsedKey);

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Gagal mendapatkan OAuth token dari Google: ${data.error_description || data.error || res.statusText}`,
    );
  }

  return data.access_token;
}

/**
 * Mengambil informasi jaringan GAM (Network Info).
 */
export async function getGamNetwork(networkCode, accessToken) {
  const url = `${GAM_BASE}/networks/${networkCode}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `GAM API Error (${res.status}): ${data.error?.message || JSON.stringify(data)}`,
    );
  }

  return {
    networkCode: data.networkCode,
    displayName: data.displayName,
    currencyCode: data.currencyCode,
    timeZone: data.timeZone,
  };
}

/**
 * Menjalankan laporan historical pendapatan GAM (AdX & AdSense).
 */
export async function fetchGamDailyRevenue(networkCode, accessToken, dateRange) {
  // 1. Buat definisi laporan
  const createUrl = `${GAM_BASE}/networks/${networkCode}/reports`;
  const reportDef = {
    reportDefinition: {
      dimensions: ["DATE", "SITE", "AD_UNIT_NAME"],
      metrics: [
        "IMPRESSIONS",
        "CLICKS",
        "AD_EXCHANGE_REVENUE",
        "ADSENSE_REVENUE",
        "AD_SERVER_REVENUE",
      ],
      dateRange: {
        fixed: {
          startDate: {
            year: Number(dateRange.startDate.slice(0, 4)),
            month: Number(dateRange.startDate.slice(5, 7)),
            day: Number(dateRange.startDate.slice(8, 10)),
          },
          endDate: {
            year: Number(dateRange.endDate.slice(0, 4)),
            month: Number(dateRange.endDate.slice(5, 7)),
            day: Number(dateRange.endDate.slice(8, 10)),
          },
        },
      },
      reportType: "HISTORICAL",
    },
  };

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reportDef),
  });

  const reportData = await createRes.json();
  if (!createRes.ok) {
    throw new Error(
      `GAM Create Report Error (${createRes.status}): ${reportData.error?.message || JSON.stringify(reportData)}`,
    );
  }

  const reportName = reportData.name; // format: networks/{code}/reports/{reportId}

  // 2. Jalankan laporan (Run report)
  const runUrl = `${GAM_BASE}/${reportName}:run`;
  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const runData = await runRes.json();
  if (!runRes.ok) {
    throw new Error(
      `GAM Run Report Error (${runRes.status}): ${runData.error?.message || JSON.stringify(runData)}`,
    );
  }

  const operationName = runData.name; // format: networks/{code}/operations/reports/{operationId}

  // 3. Polling operasi hingga selesai
  let isDone = false;
  let attempts = 0;
  let resultName = "";
  while (!isDone && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000)); // tunggu 2 detik
    attempts++;

    const pollRes = await fetch(`${GAM_BASE}/${operationName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const pollData = await pollRes.json();
    if (pollData.done) {
      isDone = true;
      if (pollData.error) {
        throw new Error(`GAM Report Execution Failed: ${pollData.error.message}`);
      }

      const resultPath =
        pollData.response?.reportResult ||
        pollData.response?.name ||
        pollData.metadata?.reportResult ||
        "";

      if (resultPath) {
        resultName = resultPath;
      }
      break;
    }
  }

  if (!isDone) {
    throw new Error("Timeout menunggu kompilasi laporan Google Ad Manager.");
  }

  // 4. Ambil baris hasil laporan
  const rowsUrl = `${GAM_BASE}/${resultName}:fetchRows`;
  const rowsRes = await fetch(rowsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const resultData = await rowsRes.json();
  if (!rowsRes.ok) {
    throw new Error(
      `GAM Fetch Rows Error: ${resultData.error?.message || JSON.stringify(resultData)}`,
    );
  }

  const rows = [];
  for (const r of resultData.rows || []) {
    const dValues = (r.dimensionValues || []).map((v) =>
      v?.stringValue != null ? v.stringValue : String(v?.intValue ?? v?.value ?? ""),
    );
    const mValues = r.metricValueGroups?.[0]?.primaryValues || r.metricValues || [];

    const dateStr = dValues[0] || "";
    const siteName = dValues[1] || "";
    const adUnitName = dValues[2] || "";

    const parseNum = (v) =>
      Number(
        v?.doubleValue != null
          ? v.doubleValue
          : v?.integerValue != null
            ? v.integerValue
            : (v?.value ?? 0),
      );

    const impressions = parseNum(mValues[0]);
    const clicks = parseNum(mValues[1]);
    const adxRevenue = parseNum(mValues[2]);
    const adsenseRevenue = parseNum(mValues[3]);
    const adServerRevenue = parseNum(mValues[4]);

    rows.push({
      date: dateStr,
      siteName,
      adUnitName,
      impressions,
      clicks,
      adxRevenue,
      adsenseRevenue,
      adServerRevenue,
      totalRevenue: adxRevenue + adsenseRevenue + adServerRevenue,
    });
  }

  return rows;
}
