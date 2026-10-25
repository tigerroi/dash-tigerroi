// Rincian campaign yang menumpuk di satu subdomain, dari baris ROI.
//
// RTDB mengembalikan array sebagai objek begitu indeksnya berlubang (lihat toCampaignArray di
// useFirebaseStore) — rincian campaign tidak boleh diam-diam hilang cuma karena bentuk kirimannya
// berbeda, apalagi jadinya terbaca sebagai "belum ada campaign terpetakan".
export function toCampaignList(value) {
  if (!value) {
    return [];
  }

  return (Array.isArray(value) ? value : Object.values(value)).filter((entry) => entry?.name);
}
