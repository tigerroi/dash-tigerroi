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
      currencyCode: "IDR",
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

  // 3. Polling operasi hingga selesai (maksimal 60 attempts x 3 detik = 180 detik / 3 menit)
  let isDone = false;
  let attempts = 0;
  let resultName = "";
  while (!isDone && attempts < 60) {
    await new Promise((r) => setTimeout(r, 3000)); // tunggu 3 detik
    attempts++;

    const pollRes = await fetch(`${GAM_BASE}/${operationName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const pollData = await pollRes.json();

    if (!pollRes.ok) {
      console.warn(`    ⚠️ Peringatan polling GAM (${pollRes.status}): ${pollData.error?.message || JSON.stringify(pollData)}`);
      continue;
    }

    if (attempts % 5 === 0) {
      console.log(`    ⏳ Masih menunggu kompilasi laporan GAM (${attempts * 3} detik)...`);
    }

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
    throw new Error("Timeout menunggu kompilasi laporan Google Ad Manager (melebihi 3 menit).");
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

  const formatIso = (d) => {
    const s = String(d || "").replace(/\D/g, "");
    return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(d);
  };

  const rows = [];
  for (const r of resultData.rows || []) {
    const dValues = (r.dimensionValues || []).map((v) =>
      v?.stringValue != null ? v.stringValue : String(v?.intValue ?? v?.value ?? ""),
    );
    const mValues = r.metricValueGroups?.[0]?.primaryValues || r.metricValues || [];

    const dateStr = formatIso(dValues[0] || "");
    const siteName = dValues[1] || "";
    const adUnitName = dValues[2] || "";

    const parseNum = (v) =>
      Number(
        v?.doubleValue != null
          ? v.doubleValue
          : v?.intValue != null
            ? v.intValue
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

/**
 * Menjalankan laporan historical Rasio Penayangan (Fill Rate) per jam dari GAM.
 * Metrik: AD_EXCHANGE_TOTAL_REQUESTS (permintaan) dan AD_EXCHANGE_IMPRESSIONS (tayangan).
 * Dimensi: DATE, HOUR, SITE.
 */
export async function fetchGamHourlyFillRate(networkCode, accessToken, dateRange) {
  const createUrl = `${GAM_BASE}/networks/${networkCode}/reports`;
  const reportDef = {
    reportDefinition: {
      dimensions: ["DATE", "HOUR", "SITE"],
      metrics: ["AD_EXCHANGE_TOTAL_REQUESTS", "AD_EXCHANGE_IMPRESSIONS"],
      currencyCode: "IDR",
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
      `GAM Create Fill Rate Report Error (${createRes.status}): ${reportData.error?.message || JSON.stringify(reportData)}`,
    );
  }

  const reportName = reportData.name;

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
      `GAM Run Fill Rate Report Error (${runRes.status}): ${runData.error?.message || JSON.stringify(runData)}`,
    );
  }

  const operationName = runData.name;

  let isDone = false;
  let attempts = 0;
  let resultName = "";
  while (!isDone && attempts < 40) {
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;

    const pollRes = await fetch(`${GAM_BASE}/${operationName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const pollData = await pollRes.json();

    if (!pollRes.ok) {
      continue;
    }

    if (pollData.done) {
      isDone = true;
      if (pollData.error) {
        throw new Error(`GAM Fill Rate Report Failed: ${pollData.error.message}`);
      }
      resultName =
        pollData.response?.reportResult ||
        pollData.response?.name ||
        pollData.metadata?.reportResult ||
        "";
      break;
    }
  }

  if (!isDone || !resultName) {
    throw new Error("Timeout menunggu kompilasi laporan Fill Rate GAM.");
  }

  const rowsUrl = `${GAM_BASE}/${resultName}:fetchRows`;
  const rowsRes = await fetch(rowsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const resultData = await rowsRes.json();
  if (!rowsRes.ok) {
    throw new Error(
      `GAM Fetch Fill Rate Rows Error: ${resultData.error?.message || JSON.stringify(resultData)}`,
    );
  }

  const parseNum = (v) =>
    Number(
      v?.doubleValue != null
        ? v.doubleValue
        : v?.intValue != null
          ? v.intValue
          : v?.integerValue != null
            ? v.integerValue
            : (v?.value ?? 0),
    );

  const formatIso = (d) => {
    const s = String(d || "").replace(/\D/g, "");
    return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(d);
  };

  const rows = [];
  for (const r of resultData.rows || []) {
    const dValues = (r.dimensionValues || []).map((v) =>
      v?.stringValue != null ? v.stringValue : String(v?.intValue ?? v?.value ?? ""),
    );
    const mValues = r.metricValueGroups?.[0]?.primaryValues || r.metricValues || [];

    const dateStr = formatIso(dValues[0] || "");
    const hourStr = String(dValues[1] || "").padStart(2, "0");
    const siteName = dValues[2] || "";

    const requests = parseNum(mValues[0]);
    const impressions = parseNum(mValues[1]);

    rows.push({
      date: dateStr,
      hour: hourStr,
      siteName,
      requests,
      impressions,
    });
  }

  return rows;
}

/**
 * Menjalankan laporan historical Pendapatan GAM per jam (Hourly Revenue).
 * Dimensi: DATE, HOUR, SITE, AD_UNIT_NAME (fallback DATE, HOUR, SITE).
 * Metrik: IMPRESSIONS, CLICKS, AD_EXCHANGE_REVENUE, ADSENSE_REVENUE, AD_SERVER_REVENUE.
 */
export async function fetchGamHourlyRevenue(networkCode, accessToken, dateRange) {
  const createUrl = `${GAM_BASE}/networks/${networkCode}/reports`;

  const buildReportDef = (dims) => ({
    reportDefinition: {
      dimensions: dims,
      metrics: [
        "IMPRESSIONS",
        "CLICKS",
        "AD_EXCHANGE_REVENUE",
        "ADSENSE_REVENUE",
        "AD_SERVER_REVENUE",
      ],
      currencyCode: "IDR",
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
  });

  let reportData;
  let createRes;
  let hasAdUnit = true;

  // Coba dengan AD_UNIT_NAME dulu agar akurasi pemetaan per subdomain maksimal
  createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildReportDef(["DATE", "HOUR", "SITE", "AD_UNIT_NAME"])),
  });

  reportData = await createRes.json();

  if (!createRes.ok) {
    // Jika GAM menolak AD_UNIT_NAME bersama HOUR, fallback ke ["DATE", "HOUR", "SITE"]
    hasAdUnit = false;
    createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildReportDef(["DATE", "HOUR", "SITE"])),
    });
    reportData = await createRes.json();
  }

  if (!createRes.ok) {
    throw new Error(
      `GAM Create Hourly Revenue Report Error (${createRes.status}): ${reportData.error?.message || JSON.stringify(reportData)}`,
    );
  }

  const reportName = reportData.name;

  // Run report
  const runUrl = `${GAM_BASE}/${reportName}:run`;
  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const runData = await runRes.json();
  if (!runRes.ok) {
    throw new Error(`GAM Run Hourly Report Error: ${runData.error?.message || JSON.stringify(runData)}`);
  }

  const operationName = runData.name;

  // Polling hingga selesai (maksimal 3 menit)
  let resultName = null;
  let isDone = false;
  for (let attempt = 0; attempt < 36; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`${GAM_BASE}/${operationName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const pollData = await pollRes.json();
    if (pollData.done) {
      if (pollData.error) {
        throw new Error(`GAM Hourly Report Execution Failed: ${pollData.error.message}`);
      }
      resultName = pollData.response?.reportResult || pollData.response?.name || reportName;
      isDone = true;
      break;
    }
  }

  if (!isDone) {
    throw new Error("Timeout menunggu laporan GAM Hourly Revenue.");
  }

  // Ambil baris
  const rowsUrl = `${GAM_BASE}/${resultName}:fetchRows`;
  const rowsRes = await fetch(rowsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const resultData = await rowsRes.json();
  if (!rowsRes.ok) {
    throw new Error(`GAM Fetch Hourly Rows Error: ${resultData.error?.message || JSON.stringify(resultData)}`);
  }

  const parseNum = (v) =>
    Number(
      v?.doubleValue != null
        ? v.doubleValue
        : v?.intValue != null
          ? v.intValue
          : v?.integerValue != null
            ? v.integerValue
            : (v?.value ?? 0),
    );

  const formatIso = (d) => {
    const s = String(d || "").replace(/\D/g, "");
    return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(d);
  };

  const rows = [];
  for (const r of resultData.rows || []) {
    const dValues = (r.dimensionValues || []).map((v) =>
      v?.stringValue != null ? v.stringValue : String(v?.intValue ?? v?.value ?? ""),
    );
    const mValues = r.metricValueGroups?.[0]?.primaryValues || r.metricValues || [];

    const dateStr = formatIso(dValues[0] || "");
    const hourStr = String(dValues[1] || "").padStart(2, "0");
    const siteName = dValues[2] || "";
    const adUnitName = hasAdUnit ? dValues[3] || "" : "";

    const impressions = parseNum(mValues[0]);
    const clicks = parseNum(mValues[1]);
    const adxRevenue = parseNum(mValues[2]);
    const adsenseRevenue = parseNum(mValues[3]);
    const adServerRevenue = parseNum(mValues[4]);

    rows.push({
      date: dateStr,
      hour: hourStr,
      time: `${hourStr}:00`,
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
