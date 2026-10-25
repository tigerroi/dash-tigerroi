import { Check, Plus, Upload, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  countryPresetsFor,
  createAccountOptions,
  createCampaignPayload,
  createReviewLines,
  createSubDomainOptions,
  emptyVariant,
  filledVariants,
  nextCampaignName,
  resizeVariants,
  splitCampaignLink,
  toggleVariantImage,
} from "../../lib/campaignCreate";
import { createCampaignNow, fetchCampaignAssets, uploadCampaignImage } from "../../lib/controlApi";
import { notifySuccess, notifyWarning } from "../../lib/notify";
import { LabeledControl } from "../ui/LabeledControl";
import { SelectField, toSelectOptions } from "../ui/SelectField";
import { Alert, DialogShell, useSubmit } from "./CampaignDialogs";
import { CountryPicker } from "./CountryPicker";

/**
 * Buat campaign baru: satu campaign (CBO, PAUSED), satu ad set + satu iklan per variasi teks.
 *
 * Bentuk yang lahir adalah POLA ARMADA dan tidak bisa dipilih di sini (objective, tujuan optimasi,
 * penempatan) — lihat functions/campaign-create-core.js. Yang diisi orang cuma yang benar-benar
 * berbeda antar-campaign, dan tiap batas di layar ini dibaca dari jawaban server (`limits`), bukan
 * disalin jadi angka kedua.
 *
 * Berkas sendiri, bukan di CampaignDialogs.jsx: dialog ini sebesar ketiga dialog itu digabung.
 */
const CTA_LABELS = {
  WATCH_MORE: "Tonton selengkapnya",
  LEARN_MORE: "Pelajari lebih lanjut",
  SEE_DETAILS: "Lihat detail",
};

export function CreateCampaignDialog({
  store,
  existingNames,
  onClose,
  onSavePreset,
  onRemovePreset,
}) {
  const ids = useId();
  const fileInput = useRef(null);
  // Satu kotak berkas untuk sepuluh tombol Unggah: yang menentukan gambarnya masuk ke iklan mana
  // adalah tombol yang baru ditekan, bukan sepuluh <input> tersembunyi yang harus dijaga sendiri.
  const uploadInto = useRef(0);
  const [form, setForm] = useState({
    accountId: "",
    subDomainId: "",
    subDomainName: "",
    code: "",
    link: "",
    urlTags: "",
    name: "",
    dailyBudget: "",
    countries: "",
    ageMin: 18,
    ageMax: 65,
    pageId: "",
    pixelId: "",
    startTime: "",
    cta: "WATCH_MORE",
    variants: [emptyVariant()],
  });
  const [assets, setAssets] = useState({ loading: false, error: "", data: null });
  const [upload, setUpload] = useState({ busy: false, error: "" });
  const [review, setReview] = useState(false);
  // Preset negara yang sedang dipakai/diberi nama. `id` kosong berarti belum ada yang dipilih, jadi
  // tombol Hapus tidak digambar — tombol hapus yang tidak menunjuk apa pun cuma bisa salah.
  const [preset, setPreset] = useState({ id: "", name: "" });
  const submit = useSubmit(onClose);

  const accounts = useMemo(() => createAccountOptions(store.adAccounts), [store.adAccounts]);
  const account = accounts.find((item) => item.id === form.accountId) || null;
  // Subdomain disaring ke PIC ad account yang dipilih: yang dituju iklan ini harus subdomain orang
  // yang akunnya membayarinya. Akun tanpa User Pemilik tidak menyaring apa pun.
  // Preset negara MILIK advertiser akun yang dipilih — tiap orang menamai wilayahnya sendiri, jadi
  // daftar bersama berarti sepuluh nama yang artinya cuma diketahui pembuatnya.
  const presets = useMemo(
    () => countryPresetsFor(store.countryPresets, account?.owner),
    [store.countryPresets, account?.owner],
  );
  const { targets, hidden } = useMemo(
    () => createSubDomainOptions(store.subDomains, { owner: account?.owner || "" }),
    [store.subDomains, account?.owner],
  );
  const target = targets.find((item) => item.id === form.subDomainId) || null;
  const data = assets.data;
  const limits = data?.limits;

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  // Bahan form dibaca dari Meta per ad account: pixel dan pustaka gambarnya milik akun itu, dan
  // Halaman yang ditawarkan cuma yang benar-benar dipegang System User.
  useEffect(() => {
    if (!form.accountId) {
      setAssets({ loading: false, error: "", data: null });
      return;
    }
    let alive = true;
    setAssets({ loading: true, error: "", data: null });
    // Pustaka gambar milik ad account, jadi pilihan tiap iklan ikut dilepas saat akunnya berganti:
    // hash dari akun lain ditolak Meta, dan penolakannya datang sesudah seluruh form diisi.
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) => ({ ...variant, images: [] })),
    }));
    fetchCampaignAssets(form.accountId)
      .then((body) => {
        if (!alive) return;
        setAssets({ loading: false, error: "", data: body });
        // Satu pilihan tidak perlu dipilih; lebih dari satu memang keputusan orangnya. Lewat updater,
        // bukan `set`: yang diisi di sini menimpa apa pun yang sudah diketik orang selama pembacaan.
        setForm((current) => ({
          ...current,
          pageId: body.pages.length === 1 ? body.pages[0].id : "",
          pixelId: body.pixels.length === 1 ? body.pixels[0].id : "",
        }));
      })
      .catch((error) => alive && setAssets({ loading: false, error: error.message, data: null }));
    return () => {
      alive = false;
    };
  }, [form.accountId]);

  // Berpindah ad account menyusutkan daftar subdomain; yang sudah terpilih dan tidak lagi ada di
  // dalamnya harus dilepas BERIKUT turunannya — kode, link, dan nama campaign semuanya miliknya.
  // Dibiarkan, form tetap mengirim subdomain milik orang lain yang tidak tergambar di mana pun.
  useEffect(() => {
    setForm((current) => {
      if (!current.subDomainId || targets.some((item) => item.id === current.subDomainId)) {
        return current;
      }
      return {
        ...current,
        subDomainId: "",
        subDomainName: "",
        code: "",
        link: "",
        urlTags: "",
        name: "",
      };
    });
  }, [targets]);

  const pickSubDomain = (id) => {
    const next = targets.find((item) => item.id === id);
    const first = next?.codes[0];
    set({
      subDomainId: id,
      subDomainName: next?.name || "",
      code: first?.code || "",
      link: first?.url || "",
      // Parameter diisi dari link yang tersimpan, bukan dari tempelan tetap: `bit=[race]` memang yang
      // dipakai seluruh armada, tapi yang menuliskannya cermin gating — dan tempelan di kode ini akan
      // terkirim apa adanya pada hari Keitaro mengganti nama penandanya.
      urlTags: splitCampaignLink(first?.url).urlTags,
      // Usulan nama: kode + nomor urut berikutnya. Sisanya (wilayah, nama pendek Halaman) diketik.
      name: first ? nextCampaignName(first.code, existingNames) : "",
    });
  };

  const pickCode = (code) => {
    const pair = target?.codes.find((item) => item.code === code);
    set({
      code,
      link: pair?.url || "",
      urlTags: splitCampaignLink(pair?.url).urlTags,
      name: nextCampaignName(code, existingNames),
    });
  };

  const toggleImage = (index, hash) => {
    setForm((current) => ({
      ...current,
      variants: toggleVariantImage(current.variants, index, hash, limits?.maxImages),
    }));
  };

  // Diunggah satu per satu, dan yang berhasil LANGSUNG ikut terpilih DI IKLAN yang tombolnya ditekan:
  // mengunggah lalu harus mencari gambarnya sendiri di galeri adalah langkah yang tidak menambahkan
  // apa pun, dan di form sepuluh iklan "galeri" itu sepuluh tempat.
  const onFiles = async (index, files) => {
    setUpload({ busy: true, error: "" });
    for (const file of files) {
      try {
        const { image } = await uploadCampaignImage(form.accountId, file);
        setAssets((current) =>
          current.data
            ? { ...current, data: { ...current.data, images: [image, ...current.data.images] } }
            : current,
        );
        setForm((current) => ({
          ...current,
          variants: toggleVariantImage(current.variants, index, image.hash, limits?.maxImages),
        }));
      } catch (error) {
        setUpload({ busy: false, error: error.message });
        return;
      }
    }
    setUpload({ busy: false, error: "" });
  };

  const variants = filledVariants(form.variants, limits?.minImages);
  const ready =
    Boolean(form.accountId && form.subDomainId && form.pageId && form.pixelId) &&
    Boolean(form.name.trim() && Number(form.dailyBudget) > 0 && form.countries.trim()) &&
    // SELURUH baris harus lengkap, bukan sebagian: angka "jumlah ad set" menyatakan berapa iklan
    // yang diminta, dan baris yang ditinggalkan separuh terisi berarti angka itu bohong.
    variants.length > 0 &&
    variants.length === form.variants.length;

  const send = () =>
    submit.run(async () => {
      const answer = await createCampaignNow(createCampaignPayload(form, limits?.minImages));
      notifySuccess(
        `Campaign "${answer.name}" sedang dibuat di latar — progresnya ada di panel Pekerjaan.`,
      );
    });

  if (review) {
    return (
      <DialogShell
        busy={submit.busy}
        onClose={onClose}
        subtitle="Periksa sebelum objeknya lahir"
        title="Buat campaign"
      >
        <div className="campaign-review">
          <ul>
            {createReviewLines(form, {
              accountLabel: accounts.find((item) => item.id === form.accountId)?.label,
              pageName: data?.pages.find((item) => item.id === form.pageId)?.name,
              minImages: limits?.minImages,
            }).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            Semuanya lahir PAUSED. Yang sudah lahir tidak bisa ditarik kembali dari dialog ini —
            campaign yang tidak diinginkan dihapus di Ads Manager.
          </p>
          {submit.error && <Alert>{submit.error}</Alert>}
          <div className="confirm-actions">
            <button
              className="ghost-button"
              disabled={submit.busy}
              onClick={() => setReview(false)}
              type="button"
            >
              Kembali
            </button>
            <button className="primary-button" disabled={submit.busy} onClick={send} type="button">
              {submit.busy ? "Membuat..." : "Ya, buat"}
            </button>
          </div>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      busy={submit.busy}
      onClose={onClose}
      subtitle="Satu campaign CBO, satu ad set + satu iklan per variasi teks"
      title="Buat campaign"
    >
      <form
        className="campaign-form campaign-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          setReview(true);
        }}
      >
        <LabeledControl
          hint="Campaign lahir di ad account ini, dan pixel serta pustaka gambarnya ikut dari sini. Akun yang sync-nya dimatikan tidak ditawarkan."
          id={`${ids}-account`}
          label="Ad account"
        >
          <SelectField
            id={`${ids}-account`}
            onChange={(accountId) => set({ accountId })}
            options={[
              { value: "", label: "Pilih ad account..." },
              ...accounts.map((item) => ({ value: item.id, label: item.label })),
            ]}
            value={form.accountId}
          />
        </LabeledControl>

        <LabeledControl
          hint={`Tujuan iklannya, disaring ke subdomain milik PIC ad account yang dipilih${
            hidden ? ` — ${hidden} subdomain PIC lain disembunyikan` : ""
          }. Link yang dipasang di iklan diambil dari Campaign URL baris subdomain ini; yang belum punya link tidak ditawarkan, dan akun tanpa User Pemilik menampilkan semuanya.`}
          id={`${ids}-subdomain`}
          label="Sub domain"
        >
          <SelectField
            id={`${ids}-subdomain`}
            onChange={pickSubDomain}
            options={[
              // Penyaringnya disebut di placeholder, bukan sebagai paragraf di bawah kotaknya: yang
              // perlu diketahui orang adalah daftar ini milik siapa, dan itu satu nama.
              {
                value: "",
                label: account?.owner
                  ? `Pilih subdomain ${account.owner}...`
                  : "Pilih subdomain...",
              },
              ...targets.map((item) => ({ value: item.id, label: item.name })),
            ]}
            value={form.subDomainId}
          />
        </LabeledControl>

        <LabeledControl
          hint="Kode Keitaro yang memetakan belanja campaign ini. Nama campaign WAJIB memuatnya — sync membaca nama, bukan link."
          id={`${ids}-code`}
          label="Kode campaign"
        >
          <SelectField
            disabled={!target}
            id={`${ids}-code`}
            onChange={pickCode}
            options={toSelectOptions((target?.codes || []).map((item) => item.code))}
            value={form.code}
          />
        </LabeledControl>

        <LabeledControl
          hint="Alamat tujuan iklan, dibaca dari Campaign URL baris subdomain dan tidak bisa diketik — satu huruf yang meleset di sini mengirim trafik berbayar ke nama yang tidak menjawab."
          id={`${ids}-link`}
          label="Link iklan"
        >
          <input
            className="control"
            id={`${ids}-link`}
            readOnly
            value={splitCampaignLink(form.link).link}
          />
        </LabeledControl>

        <LabeledControl
          hint="Dikirim terpisah ke Meta sebagai url_tags, persis seperti seluruh iklan armada. Bentuknya pasangan kunci=nilai dipisah &, tanpa ? di depan. Dikosongkan, Keitaro kehilangan penanda [race] dan kunjungannya tidak tercatat."
          id={`${ids}-urltags`}
          label="Parameter URL"
        >
          <input
            className="control"
            id={`${ids}-urltags`}
            maxLength={200}
            onChange={(event) => set({ urlTags: event.target.value })}
            placeholder="bit=[race]"
            value={form.urlTags}
          />
        </LabeledControl>

        <LabeledControl
          hint="Wajib memuat kode di atas, dan tidak boleh sama dengan nama campaign lain di ad account itu. Usulannya kode + nomor urut berikutnya; sisanya (wilayah, Halaman, jumlah ad set) diketik seperti kebiasaan armada."
          id={`${ids}-name`}
          label="Nama campaign"
        >
          <input
            className="control"
            id={`${ids}-name`}
            maxLength={400}
            onChange={(event) => set({ name: event.target.value })}
            placeholder="tbxW-01 Pros MEA Carrou SM 01 5 Adset"
            value={form.name}
          />
        </LabeledControl>

        <LabeledControl
          hint="Anggaran dipegang campaign (CBO) dan dibagi Meta ke tiap ad set. Rupiah."
          id={`${ids}-budget`}
          label="Anggaran harian"
        >
          <input
            className="control"
            id={`${ids}-budget`}
            inputMode="numeric"
            onChange={(event) => set({ dailyBudget: event.target.value })}
            placeholder="20000"
            value={form.dailyBudget}
          />
        </LabeledControl>

        <LabeledControl
          hint="Negara yang ditargetkan seluruh ad set campaign ini. Daftarnya negara yang benar-benar dipakai armada; kode ISO dua huruf lain bisa ditambahkan lewat kotak pencariannya."
          id={`${ids}-countries`}
          label="Negara"
        >
          <CountryPicker
            id={`${ids}-countries`}
            onChange={(countries) => set({ countries })}
            value={form.countries}
          />
        </LabeledControl>

        {account?.owner && (
          <div className="labeled-control campaign-presets">
            <span className="labeled-control-label">Preset negara {account.owner}</span>
            <div className="campaign-preset-row">
              <SelectField
                ariaLabel="Pakai preset negara tersimpan"
                className="campaign-preset-select"
                onChange={(next) => {
                  const found = presets.find((item) => item.id === next);
                  setPreset({ id: found?.id || "", name: found?.name || "" });
                  if (found) set({ countries: found.countries });
                }}
                options={[
                  {
                    value: "",
                    label: presets.length
                      ? "Pakai preset tersimpan..."
                      : `${account.owner} belum punya preset`,
                  },
                  ...presets.map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.countries})`,
                  })),
                ]}
                value={preset.id}
              />
              <input
                aria-label="Nama preset baru"
                className="control"
                maxLength={60}
                onChange={(event) => setPreset({ id: "", name: event.target.value })}
                placeholder="Nama preset, mis. MEA"
                value={preset.name}
              />
              <button
                className="ghost-button"
                disabled={!preset.name.trim() || !form.countries.trim()}
                onClick={async () => {
                  const name = preset.name.trim();
                  // Nama yang sudah dipakai advertiser ini ditolak di sini: dua preset bernama sama
                  // di satu dropdown tidak bisa dibedakan pemakainya, dan yang salah pilih baru
                  // terbaca sebagai negara yang tidak diminta.
                  if (presets.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
                    notifyWarning(
                      `${account.owner} sudah punya preset "${name}" — hapus dulu, atau pakai nama lain.`,
                    );
                    return;
                  }
                  const saved = await onSavePreset?.({
                    advertiser: account.owner,
                    name,
                    countries: form.countries,
                  });
                  if (saved) setPreset({ id: "", name: "" });
                }}
                type="button"
              >
                Simpan
              </button>
              {preset.id && (
                <button
                  className="ghost-button"
                  onClick={async () => {
                    await onRemovePreset?.(preset.id);
                    setPreset({ id: "", name: "" });
                  }}
                  type="button"
                >
                  <X size={14} /> Hapus
                </button>
              )}
            </div>
          </div>
        )}

        <div className="labeled-control campaign-age-row">
          <span className="labeled-control-label">Umur</span>
          <div className="campaign-age-inputs">
            <input
              aria-label="Umur minimum"
              className="control"
              max={65}
              min={18}
              onChange={(event) => set({ ageMin: event.target.value })}
              type="number"
              value={form.ageMin}
            />
            <span>–</span>
            <input
              aria-label="Umur maksimum"
              className="control"
              max={65}
              min={18}
              onChange={(event) => set({ ageMax: event.target.value })}
              type="number"
              value={form.ageMax}
            />
          </div>
        </div>

        <LabeledControl
          hint="Kapan ad set mulai tayang, dalam jam WIB — ditulis di ad set, dan campaign mengambil jadwal dari ad set yang paling awal (jadi kolom Status di tabel berbunyi Terjadwal berikut tanggalnya). Dikosongkan, iklannya mulai begitu campaign dinyalakan. Waktu yang sudah lewat ditolak: Meta menerimanya lalu menayangkannya seketika."
          id={`${ids}-start`}
          label="Mulai tayang"
        >
          <input
            className="control"
            id={`${ids}-start`}
            onChange={(event) => set({ startTime: event.target.value })}
            type="datetime-local"
            value={form.startTime}
          />
        </LabeledControl>

        {assets.loading && <p className="adset-note">Membaca Halaman, pixel, dan gambar akun...</p>}
        {assets.error && <Alert>{assets.error}</Alert>}

        {data && (
          <>
            <LabeledControl
              hint="Iklan lahir dari Halaman ini. Yang ditawarkan cuma Halaman yang System User pegang dengan izin beriklan — sisanya pasti ditolak Meta."
              id={`${ids}-page`}
              label="Halaman Facebook"
            >
              <SelectField
                id={`${ids}-page`}
                onChange={(pageId) => set({ pageId })}
                options={[
                  { value: "", label: "Pilih Halaman..." },
                  ...data.pages.map((page) => ({ value: page.id, label: page.name })),
                ]}
                value={form.pageId}
              />
            </LabeledControl>

            <LabeledControl
              hint="Pixel yang dioptimasi ad set (event CONTENT_VIEW), sama seperti armada. Milik ad account yang dipilih."
              id={`${ids}-pixel`}
              label="Pixel"
            >
              <SelectField
                id={`${ids}-pixel`}
                onChange={(pixelId) => set({ pixelId })}
                options={[
                  { value: "", label: "Pilih pixel..." },
                  ...data.pixels.map((pixel) => ({
                    value: pixel.id,
                    label: `${pixel.name || pixel.id}${pixel.unavailable ? " (tidak aktif)" : ""}`,
                  })),
                ]}
                value={form.pixelId}
              />
            </LabeledControl>

            <LabeledControl
              hint="Tombol yang tergambar di tiap iklan. Ketiganya yang dipakai armada hari ini."
              id={`${ids}-cta`}
              label="Tombol ajakan"
            >
              <SelectField
                id={`${ids}-cta`}
                onChange={(cta) => set({ cta })}
                options={toSelectOptions(limits.ctaTypes, (cta) => CTA_LABELS[cta] || cta)}
                value={form.cta}
              />
            </LabeledControl>

            <LabeledControl
              hint={`Satu ad set berisi satu iklan per baris, targetingnya sama persis — itu bentuk yang dipakai armada. Maksimal ${limits.maxVariants}; menurunkannya membuang baris dari bawah.`}
              id={`${ids}-adsets`}
              label="Jumlah ad set"
            >
              <input
                className="control"
                id={`${ids}-adsets`}
                max={limits.maxVariants}
                min={1}
                onChange={(event) =>
                  set({
                    variants: resizeVariants(form.variants, event.target.value, limits.maxVariants),
                  })
                }
                type="number"
                value={form.variants.length}
              />
            </LabeledControl>

            {/* Satu blok per IKLAN: teksnya DAN gambarnya. Gambar dulu satu daftar untuk seluruh
                campaign — lima ad set bergambar identik tidak bisa mengabarkan gambar mana yang
                bekerja, padahal itu yang paling menentukan hasil sebuah iklan. */}
            <div className="labeled-control campaign-variants">
              <span className="labeled-control-label">
                Iklan ({variants.length} dari {form.variants.length} lengkap) — tiap baris satu ad
                set + satu iklan, dengan carousel {limits.minImages}–{limits.maxImages} gambarnya
                sendiri
              </span>
              {upload.error && <Alert>{upload.error}</Alert>}
              <input
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                multiple
                onChange={(event) => {
                  const files = [...event.target.files];
                  event.target.value = "";
                  if (files.length) onFiles(uploadInto.current, files);
                }}
                ref={fileInput}
                type="file"
              />
              {form.variants.map((variant, index) => {
                const picked = variant.images || [];
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: barisnya memang dibedakan posisinya.
                  <div className="campaign-variant" key={index}>
                    <div className="campaign-variant-head">
                      <strong>Iklan {index + 1}</strong>
                      {/* Kekurangannya disebut KALIMATNYA, bukan warnanya: "2 gambar" yang merah
                          tidak memberi tahu berapa yang kurang, dan kelas warna baru berarti satu
                          nilai yang harus hidup di kedua blok token. */}
                      <span className="muted-line">
                        {picked.length} gambar
                        {picked.length < limits.minImages ? ` — minimal ${limits.minImages}` : ""}
                      </span>
                      <button
                        className="ghost-button"
                        disabled={upload.busy}
                        onClick={() => {
                          uploadInto.current = index;
                          fileInput.current?.click();
                        }}
                        type="button"
                      >
                        <Upload size={14} /> {upload.busy ? "Mengunggah..." : "Unggah"}
                      </button>
                      <button
                        aria-label={`Hapus iklan ${index + 1}`}
                        className="ghost-button icon-button"
                        disabled={form.variants.length === 1}
                        onClick={() =>
                          set({ variants: form.variants.filter((_, at) => at !== index) })
                        }
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      aria-label={`Judul iklan ${index + 1}`}
                      className="control"
                      maxLength={255}
                      onChange={(event) => {
                        const next = [...form.variants];
                        next[index] = { ...variant, title: event.target.value };
                        set({ variants: next });
                      }}
                      placeholder={`Judul iklan ${index + 1}`}
                      value={variant.title}
                    />
                    <input
                      aria-label={`Body iklan ${index + 1}`}
                      className="control"
                      maxLength={2000}
                      onChange={(event) => {
                        const next = [...form.variants];
                        next[index] = { ...variant, body: event.target.value };
                        set({ variants: next });
                      }}
                      placeholder="Body iklan"
                      value={variant.body}
                    />
                    <div className="campaign-image-grid">
                      {data.images.length === 0 && (
                        <p className="adset-note">
                          Pustaka ad account ini masih kosong — unggah gambarnya dari sini.
                        </p>
                      )}
                      {data.images.map((image) => {
                        const at = picked.indexOf(image.hash);
                        return (
                          <button
                            aria-pressed={at >= 0}
                            className={`campaign-image${at >= 0 ? " is-picked" : ""}`}
                            key={image.hash}
                            onClick={() => toggleImage(index, image.hash)}
                            title={image.name || image.hash}
                            type="button"
                          >
                            {image.thumbnail ? (
                              <img alt={image.name || "gambar iklan"} src={image.thumbnail} />
                            ) : (
                              <span className="campaign-image-blank">{image.hash.slice(0, 6)}</span>
                            )}
                            {at >= 0 && <span className="campaign-image-badge">{at + 1}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {form.variants.length < limits.maxVariants && (
                <button
                  className="ghost-button"
                  onClick={() =>
                    set({
                      variants: resizeVariants(
                        form.variants,
                        form.variants.length + 1,
                        limits.maxVariants,
                      ),
                    })
                  }
                  type="button"
                >
                  <Plus size={14} /> Tambah iklan
                </button>
              )}
            </div>
          </>
        )}

        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="confirm-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={!ready} type="submit">
            <Check size={14} /> Tinjau
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
