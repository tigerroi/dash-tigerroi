import { localStore } from "./localStore.js";
// Tema: perangkat yang memutuskan sampai ada orang yang memutuskan lain.
//
// Tiga keadaan, bukan dua: "ikut perangkat" (belum pernah ditekan), "terang", dan "gelap". Yang
// tersimpan cuma keadaan kedua dan ketiga — `null` di penyimpanan BUKAN berarti terang, melainkan
// belum memilih, dan itu yang membuat dashboard ikut berubah saat sistem berpindah ke mode malam.
export const THEME_STORAGE_KEY = "rabbitroi:theme";
export const DEFAULT_THEME = "light";

export function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : null;
}

// Perangkat yang tidak menyatakan apa-apa jatuh ke terang, sama seperti sebelum tombol ini ada.
export function resolveTheme({ stored, system } = {}) {
  return normalizeTheme(stored) ?? normalizeTheme(system) ?? DEFAULT_THEME;
}

/**
 * Menekan tombol saat tema yang dituju SAMA dengan tema perangkat akan menghapus pilihannya, bukan
 * menyimpannya.
 *
 * Itu yang menggantikan keadaan ketiga di tombol. Saklar dua posisi yang selalu menyimpan berarti
 * sekali ditekan, seumur hidup akun itu dashboard berhenti mengikuti perangkat — orang yang
 * sistemnya berpindah gelap tiap senja tidak punya cara kembali selain membersihkan localStorage.
 * Dengan aturan ini, kembali ke "ikut perangkat" cukup dengan menekan tombolnya sampai temanya
 * sama dengan tema sistem, dan itu persis gerakan yang sudah dilakukan orang untuk keluar dari
 * tema yang tidak diinginkannya.
 */
export function nextTheme({ current, system } = {}) {
  const theme = current === "dark" ? "light" : "dark";
  return { theme, stored: theme === normalizeTheme(system) ? null : theme };
}

function readStoredTheme() {
  try {
    return normalizeTheme(localStore()?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredTheme(stored) {
  try {
    if (stored) localStore()?.setItem(THEME_STORAGE_KEY, stored);
    else localStore()?.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* Pilihannya tetap berlaku untuk sesi ini; yang hilang cuma ingatannya. */
  }
}

function systemTheme() {
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return DEFAULT_THEME;
  }
}

const listeners = new Set();
let active = null;

export function currentTheme() {
  if (active === null) {
    // Nilai yang sudah dipasang skrip boot di index.html — dibaca, bukan dihitung ulang, supaya
    // yang tergambar di layar dan yang dikira modul ini tidak pernah berbeda.
    active =
      normalizeTheme(globalThis.document?.documentElement?.dataset?.theme) ??
      resolveTheme({ stored: readStoredTheme(), system: systemTheme() });
  }
  return active;
}

export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(theme) {
  active = theme;
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = theme;
    // `color-scheme` di meta, bukan cuma di CSS: yang membacanya adalah browser saat memutuskan
    // warna scrollbar dan kanvas di luar halaman.
    root.ownerDocument.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
    // Warna bilah alamat DIBACA dari token, bukan disalin ke daftar hex kedua di sini: satu-satunya
    // yang tahu warna latar tema ini adalah stylesheet-nya.
    const background = globalThis.getComputedStyle?.(root).getPropertyValue("--background").trim();
    if (background) {
      root.ownerDocument
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", background);
    }
  }
  for (const listener of listeners) listener(theme);
}

export function toggleTheme() {
  const { theme, stored } = nextTheme({ current: currentTheme(), system: systemTheme() });
  writeStoredTheme(stored);
  apply(theme);
  return theme;
}

/**
 * Dipanggil sekali dari main.jsx. Skrip boot di index.html sudah memasang atributnya sebelum
 * halaman dicat; yang ditambahkan di sini adalah yang tidak bisa dilakukan sebelum stylesheet ada
 * (warna bilah alamat) dan yang berumur sepanjang sesi (perangkat yang berpindah tema di tengah
 * jalan — dan itu HANYA berlaku untuk yang belum memilih sendiri).
 */
export function initTheme() {
  apply(currentTheme());

  let query = null;
  try {
    query = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  } catch {
    query = null;
  }
  query?.addEventListener?.("change", () => {
    if (readStoredTheme()) return;
    apply(systemTheme());
  });
}
