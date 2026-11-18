/**
 * Log IP Terblokir & Dilempar ke YouTube (Live Bot Traps)
 * Menampilkan IP crawler/bot dan akses tanpa parameter iklan yang dicegat.
 */

export const DEFAULT_BLOCKED_LOGS = [
  {
    id: "b1",
    time: "01:46:32",
    ip: "114.122.14.88",
    country: "ID",
    slug: "/eat",
    target: "eat.foodsfact.org (DWDM)",
    reason: "Buka Langsung Tanpa Iklan (Direct Access)",
    action: "Dilempar ke YouTube ➔",
    youtube: "https://youtu.be/EQGSwZDZ3Ts?si=_xINNlx6i7fQAXJK",
  },
  {
    id: "b2",
    time: "01:41:15",
    ip: "52.167.144.92",
    country: "US",
    slug: "/eat",
    target: "eat.foodsfact.org (DWDM)",
    reason: "Bot Scraper / Headless Crawler (curl)",
    action: "Dilempar ke YouTube ➔",
    youtube: "https://youtu.be/AUgL4y3G9Vg?si=zRrgx3zPre7vEVVA",
  },
  {
    id: "b3",
    time: "01:35:20",
    ip: "198.235.24.12",
    country: "US",
    slug: "/guides",
    target: "guides.foodsfact.org (TG1D)",
    reason: "Python Request / Non-Browser Agent",
    action: "Dilempar ke YouTube ➔",
    youtube: "https://youtu.be/lb7ctVNBRV0?si=ug4KsEXFLHBFs-zM",
  },
  {
    id: "b4",
    time: "01:28:44",
    ip: "172.56.21.90",
    country: "US",
    slug: "/property",
    target: "property.foodsfact.org (WMYN)",
    reason: "Bot Scraper Tanpa Parameter Iklan Meta",
    action: "Dilempar ke YouTube ➔",
    youtube: "https://youtu.be/7Z1bEhzIxFc?si=_duj16uN0QPoMCfT",
  },
  {
    id: "b5",
    time: "01:15:02",
    ip: "66.249.66.1",
    country: "US",
    slug: "/menu",
    target: "menu.ihopmenuwithprices.us (WYJ7)",
    reason: "Crawler Liar Non-Whitelisted",
    action: "Dilempar ke YouTube ➔",
    youtube: "https://youtu.be/3DdYl026Z6k?si=MnYlzwam7degVmE_",
  },
];

export async function fetchLiveBlockedLogs(workerUrl = "https://visint-gating.tiger-roiunlimited.workers.dev") {
  try {
    const res = await fetch(`${workerUrl}/api/blocked`, { mode: "cors" });
    if (res.ok) {
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        return data.items.map((it) => ({
          id: it.id,
          time: new Date(it.time).toLocaleTimeString("id-ID"),
          ip: it.ip,
          country: it.country || "US",
          slug: it.slug,
          target: it.slug,
          reason: it.reason,
          action: "Dilempar ke YouTube ➔",
          youtube: it.redirectedTo,
        }));
      }
    }
  } catch {
    // Abaikan jika network gagal dan gunakan default
  }
  return DEFAULT_BLOCKED_LOGS;
}
