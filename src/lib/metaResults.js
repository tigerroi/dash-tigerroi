// Nama baca untuk `action_type` Meta — isi kolom "Hasil" di tabel Kampanye.
//
// Angka hasil tidak bisa dibaca tanpa tahu ia menghitung apa: "2.449" bisa berarti 2.449 orang yang
// melihat halaman produk atau 2.449 lead, dan keduanya menuntut kesimpulan yang sangat berbeda
// tentang campaign yang sama. Ads Manager menuliskannya di bawah angkanya; tabel ini ikut.
//
// Yang dipakai adalah nama yang sama dengan di Ads Manager berbahasa Indonesia, supaya angkanya
// bisa diadu baris per baris tanpa menerjemahkan apa pun di kepala.
const LABELS = {
  "offsite_conversion.fb_pixel_view_content": "Konten dilihat",
  omni_view_content: "Konten dilihat",
  view_content: "Konten dilihat",
  "offsite_conversion.fb_pixel_purchase": "Pembelian",
  omni_purchase: "Pembelian",
  purchase: "Pembelian",
  "offsite_conversion.fb_pixel_lead": "Prospek",
  omni_lead: "Prospek",
  lead: "Prospek",
  "onsite_conversion.lead_grouped": "Prospek (formulir)",
  leadgen_grouped: "Prospek (formulir)",
  "offsite_conversion.fb_pixel_complete_registration": "Pendaftaran selesai",
  omni_complete_registration: "Pendaftaran selesai",
  complete_registration: "Pendaftaran selesai",
  "offsite_conversion.fb_pixel_add_to_cart": "Tambah ke keranjang",
  omni_add_to_cart: "Tambah ke keranjang",
  add_to_cart: "Tambah ke keranjang",
  "offsite_conversion.fb_pixel_initiate_checkout": "Checkout dimulai",
  omni_initiated_checkout: "Checkout dimulai",
  initiate_checkout: "Checkout dimulai",
  "offsite_conversion.fb_pixel_add_payment_info": "Info pembayaran",
  add_payment_info: "Info pembayaran",
  "offsite_conversion.fb_pixel_search": "Pencarian",
  omni_search: "Pencarian",
  search: "Pencarian",
  "offsite_conversion.fb_pixel_subscribe": "Langganan",
  subscribe: "Langganan",
  "offsite_conversion.fb_pixel_start_trial": "Uji coba dimulai",
  start_trial: "Uji coba dimulai",
  "offsite_conversion.fb_pixel_contact": "Kontak",
  contact: "Kontak",
  "offsite_conversion.fb_pixel_submit_application": "Aplikasi dikirim",
  submit_application: "Aplikasi dikirim",
  landing_page_view: "Tampilan halaman landing",
  omni_landing_page_view: "Tampilan halaman landing",
  link_click: "Klik tautan",
  post_engagement: "Interaksi kiriman",
  page_engagement: "Interaksi halaman",
  like: "Suka halaman",
  "onsite_conversion.post_net_like": "Suka halaman",
  rsvp: "Respons acara",
  video_view: "Penayangan video",
  mobile_app_install: "Pemasangan aplikasi",
  omni_app_install: "Pemasangan aplikasi",
  app_install: "Pemasangan aplikasi",
  "onsite_conversion.messaging_conversation_started_7d": "Percakapan dimulai",
  "onsite_conversion.total_messaging_connection": "Koneksi pesan",
};

/**
 * Nama baca sebuah action_type. Yang tidak ada di daftar dikembalikan apa adanya — nama teknisnya
 * masih bisa dicari di dokumentasi Meta, sementara "-" akan menyembunyikan bahwa kolomnya
 * menghitung sesuatu yang belum pernah kita lihat.
 */
export function resultLabel(actionType) {
  const key = String(actionType || "").trim();
  if (!key) return "";
  return LABELS[key] || key;
}
