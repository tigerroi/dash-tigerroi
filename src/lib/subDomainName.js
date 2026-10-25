import { hostOf } from "./cloudflareDns.js";

/**
 * Nama subdomain di form ditulis PENDEK ("care"), karena Domain Induk sudah dipilih di kotak
 * sebelahnya; yang tersimpan tetap hostname PENUH ("care.petcins.com") — itu yang dicocokkan sync
 * dengan laporan GAM/AdSense dan dengan record DNS.
 */
export function shortSubDomain(name, parentDomain) {
  const full = String(name || "").trim();
  const parent = hostOf(parentDomain);
  if (!parent || !full.toLowerCase().endsWith(`.${parent}`)) return full;
  return full.slice(0, -(parent.length + 1));
}

/**
 * Kebalikannya saat disimpan. Yang sudah diketik lengkap (berakhiran domain induknya, atau domain
 * induk itu sendiri) dibiarkan — tanpa itu, yang terbiasa mengetik nama penuh menghasilkan
 * `care.petcins.com.petcins.com`. Yang TIDAK diubah orang saat menyunting juga dibiarkan: baris
 * lama yang namanya tidak berakhiran domain induknya tidak boleh berubah hanya karena dibuka.
 */
export function fullSubDomain(typed, parentDomain, original = "") {
  const value = String(typed || "")
    .trim()
    .replace(/\.$/, "");
  const parent = hostOf(parentDomain);
  if (!value || !parent) return value;
  if (original && value === shortSubDomain(original, parentDomain)) return original;
  const lower = value.toLowerCase();
  if (lower === parent || lower.endsWith(`.${parent}`)) return value;
  return `${value}.${parent}`;
}
