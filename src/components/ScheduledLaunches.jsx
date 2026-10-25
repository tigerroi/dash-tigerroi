import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { canToggleCampaign } from "../config/access";
import { useUrlState } from "../hooks/useUrlState";
import { fleetCampaignRows } from "../lib/campaignRows";
import { CONTROL_API_ENABLED, fetchScheduledLaunches, shiftAdSetStart } from "../lib/controlApi";
import { formatDateTime } from "../lib/formatDate";
import { notifySuccess, notifyWarning } from "../lib/notify";
import {
  campaignIndexOf,
  freeMinuteAfter,
  launchCampaignCount,
  launchOwnerEmail,
  launchPics,
  launchRows,
  launchSlots,
  sameServer,
  shiftPlan,
} from "../lib/scheduledLaunches";
import { Dialog } from "./ui/Dialog";
import { EmptyMessage } from "./ui/EmptyMessage";
import { ExpandToggle } from "./ui/ExpandToggle";
import { LabeledControl } from "./ui/LabeledControl";
import { RefreshButton } from "./ui/RefreshButton";
import { SelectField } from "./ui/SelectField";

/**
 * Tab "Terjadwal" di Overview: seluruh campaign yang AKAN mulai tayang, satu kartu per jam mulai,
 * dan jam yang memuat dua campaign atau lebih diberi peringatan.
 *
 * Ada supaya advertiser tidak menjadwalkan di menit yang sama dengan rekannya: iklan yang menyala
 * serentak mengirim lonjakan trafik ke server situs yang sebagian besar berbagi hosting. Datanya dibaca server kontrol dari Meta saat tab dibuka
 * (cermin bersama dua menit) — ad set tidak dicerminkan ke RTDB, jadi tanpa server kontrol tab ini
 * tidak bisa dibuka, dan yang digambar adalah sebabnya, bukan daftar kosong yang terbaca seperti
 * "tidak ada jadwal".
 */
export function ScheduledLaunches({ store, viewer }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [refreshing, setRefreshing] = useState(false);
  const [pic, setPic] = useUrlState("pic", "");
  // Campaign yang ad set-nya sedang dibuka tinggal di ALAMAT (`?adset=`), `replace` — ia membuka isi
  // di halaman yang sama, dan Back tidak boleh jadi tombol "tutup dropdown". Kuncinya menit + campaign:
  // satu campaign bisa berdiri di beberapa kartu kalau ad set-nya mulai di jam berbeda.
  const [openAdSets, setOpenAdSets] = useUrlState("adset", "");
  // Campaign yang sedang digeser: { slot, campaign }. Bukan di alamat — dialog tulis ke Meta yang
  // terbuka lagi dari tautan yang disalin adalah tindakan yang tidak diminta siapa pun.
  const [shifting, setShifting] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const data = await fetchScheduledLaunches({ refresh });
      if (alive.current) setState({ loading: false, error: "", data });
    } catch (error) {
      // Bacaan lama TIDAK dibuang: daftar yang sudah tergambar tetap berguna, dan umurnya disebut.
      if (alive.current) setState((prev) => ({ ...prev, loading: false, error: error.message }));
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (CONTROL_API_ENABLED) load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const campaignIndex = useMemo(
    () => campaignIndexOf(fleetCampaignRows(store.users)),
    [store.users],
  );
  const allRows = useMemo(
    () => launchRows(state.data?.rows, { campaignIndex }),
    [state.data, campaignIndex],
  );
  // Bentrok dihitung atas SELURUH armada, baru disaring PIC — dan jam yang lolos saringan tetap
  // menggambar SEMUA campaign-nya: advertiser yang menyaring dirinya sendiri justru perlu tahu
  // jadwalnya bertabrakan dengan milik siapa.
  const allSlots = useMemo(
    () => launchSlots(allRows, { servers: state.data?.servers ?? null }),
    [allRows, state.data],
  );
  const slots = useMemo(
    () => (pic ? allSlots.filter((slot) => slot.campaigns.some((c) => c.pic === pic)) : allSlots),
    [allSlots, pic],
  );
  const picOptions = useMemo(() => {
    const names = launchPics(allRows);
    // Nilai yang menyaring tapi tidak ada di daftar tetap digambar — tanpa itu select-nya kosong di
    // atas daftar yang juga kosong, dan tidak ada yang menyebut apa yang sedang menyaring.
    if (pic && !names.includes(pic)) names.push(pic);
    return [
      { value: "", label: "Semua PIC" },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [allRows, pic]);

  if (!CONTROL_API_ENABLED) {
    return (
      <section className="panel">
        <EmptyMessage>
          Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>). Jadwal ad set
          dibaca langsung dari Meta lewat server itu dan tidak dicerminkan ke database, jadi tab ini
          tidak bisa dibuka tanpanya.
        </EmptyMessage>
      </section>
    );
  }

  const data = state.data;
  const campaignCount = launchCampaignCount(allRows);
  const clashes = slots.filter((slot) => slot.clash);

  return (
    <>
      {state.error && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>{state.error}</span>
        </p>
      )}

      {/* Akun yang gagal dibaca DISEBUT: daftar yang diam-diam kehilangan satu akun terbaca sebagai
          "tidak ada yang bentrok", dan orang lalu menjadwalkan di menit yang justru terisi. */}
      {data?.failedAccounts?.length > 0 && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>
            Jadwal {data.failedAccounts.length} ad account tidak terbaca, jadi daftar ini belum
            lengkap: {data.failedAccounts.map((item) => item.name).join(", ")}.
          </span>
        </p>
      )}

      {/* Server yang tidak terbaca DISEBUT: tanpa peta server, tiap menit yang sama dihitung bentrok
          (server tidak diketahui tidak bisa dibuktikan berbeda), dan tanpa kalimat ini peringatannya
          terbaca seolah semua situs itu memang satu mesin. */}
      {data && data.servers === null && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>
            Server tiap subdomain tidak terbaca dari Cloudflare ({data.serverError || "tanpa sebab"}
            ) — semua jadwal di menit yang sama dianggap bentrok.
          </span>
        </p>
      )}

      {/* Ringkasan peringatan di ATAS daftar: kartu kuning yang ketiga belas di bawah lipatan layar
          tidak terlihat oleh orang yang sedang memilih jam untuk campaign barunya. */}
      {clashes.length > 0 && (
        <p className="plugin-alert launch-clash-alert">
          <TriangleAlert size={15} />
          <span>
            {clashes.length} jam dipakai lebih dari satu campaign di server yang sama — sebaiknya
            salah satunya digeser:{" "}
            {clashes
              .map(
                (slot) =>
                  `${formatDateTime(slot.minute)} (${slot.campaigns
                    .filter((item) => item.clash)
                    .map((item) => item.pic || "(tanpa PIC)")
                    .join(", ")})`,
              )
              .join("; ")}
            .
          </span>
        </p>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Jadwal tayang</h2>
            <p>
              {data
                ? `${campaignCount} campaign terjadwal · ${clashes.length} jam bentrok · dibaca ${formatDateTime(data.readAt)}`
                : "Membaca jadwal dari Meta..."}
            </p>
          </div>
          <div className="launch-toolbar">
            <SelectField ariaLabel="PIC" onChange={setPic} options={picOptions} value={pic} />
            <RefreshButton busy={state.loading || refreshing} onClick={() => load(true)} />
          </div>
        </div>

        {state.loading && !data ? (
          <EmptyMessage>Membaca jadwal ad set seluruh ad account dari Meta...</EmptyMessage>
        ) : data && slots.length === 0 ? (
          <EmptyMessage>
            {pic
              ? `Tidak ada jadwal milik ${pic}.`
              : "Tidak ada campaign maupun ad set yang terjadwal — semua yang saklarnya On sudah tayang."}
          </EmptyMessage>
        ) : (
          <div className="launch-slots">
            {slots.map((slot) => (
              <LaunchSlot
                canShift={(campaign) =>
                  canToggleCampaign(
                    viewer?.role,
                    launchOwnerEmail(store.users, campaign.pic),
                    viewer?.email,
                  )
                }
                key={slot.minute}
                onShift={(campaign) => setShifting({ slot, campaign })}
                onToggle={(key) => setOpenAdSets(openAdSets === key ? "" : key)}
                openKey={openAdSets}
                slot={slot}
              />
            ))}
          </div>
        )}
      </section>

      {shifting && (
        <ShiftDialog
          adSetRows={allRows}
          campaign={shifting.campaign}
          onClose={() => setShifting(null)}
          onDone={() => load(true)}
          slot={shifting.slot}
          slots={allSlots}
        />
      )}
    </>
  );
}

/**
 * Geser jam mulai satu campaign — langsung ke Meta, tanpa membuka Ads Manager.
 *
 * SELURUH ad set terjadwal campaign itu bergeser dengan selisih yang sama (`shiftPlan`), jadi yang
 * dipilih orang cuma jam baru untuk kartu ini; ad set di jam lain ikut mundur/maju sejauh itu dan
 * daftarnya disebut sebelum Simpan. Ditulis BERURUTAN, satu ad set per request: satu yang ditolak
 * tidak menghentikan sisanya, dan hasilnya satu toast yang menyebut yang gagal. Sesudahnya daftar
 * DIBACA ULANG dari Meta (server sudah membuang cerminnya), bukan ditambal di layar.
 */
function ShiftDialog({ slot, campaign, adSetRows, slots, onClose, onDone }) {
  const ids = useId();
  const [value, setValue] = useState(() => freeMinuteAfter(slots, slot.minute));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = shiftPlan(adSetRows, campaign.id, slot.minute, value);
  const changed = plan.length > 0 && value !== slot.minute;
  // Menit tujuan yang sudah dipakai campaign lain: tetap boleh disimpan (orangnya mungkin sedang
  // menukar dua jadwal), tapi disebut — itu persis bentrok yang sedang ingin dihapus.
  const clashesWith = slots.find(
    (item) =>
      item.minute === value &&
      item.campaigns.some((other) => other.id !== campaign.id && sameServer(campaign, other)),
  );

  async function save(event) {
    event.preventDefault();
    if (!changed) return;
    setBusy(true);
    setError("");
    const failed = [];
    for (const item of plan) {
      try {
        await shiftAdSetStart(item.adSetId, item.startTime);
      } catch (reason) {
        failed.push(`${item.adSet || item.adSetId}: ${reason.message}`);
      }
    }
    setBusy(false);
    onDone();
    const moved = plan.length - failed.length;
    if (!failed.length) {
      notifySuccess(`${moved} ad set ${campaign.campaign} digeser ke ${formatDateTime(value)}.`);
      onClose();
      return;
    }
    if (moved) notifyWarning(`${moved} dari ${plan.length} ad set digeser; sisanya gagal.`);
    setError(failed.join(" · "));
  }

  return (
    <Dialog busy={busy} onClose={onClose} subtitle={campaign.campaign} title="Geser jam mulai">
      <form className="campaign-form" onSubmit={save}>
        <LabeledControl
          hint="Jam operasi (WIB). Seluruh ad set terjadwal campaign ini bergeser sejauh selisihnya, termasuk yang mulai di jam lain."
          id={`${ids}-start`}
          label={`Jam mulai baru (sekarang ${formatDateTime(slot.minute)})`}
        >
          <input
            className="control"
            disabled={busy}
            id={`${ids}-start`}
            onChange={(event) => setValue(event.target.value)}
            type="datetime-local"
            value={value}
          />
        </LabeledControl>
        {clashesWith && (
          <p className="plugin-alert">
            <TriangleAlert size={15} />
            <span>
              {formatDateTime(value)} sudah dipakai{" "}
              {clashesWith.campaigns
                .filter((item) => item.id !== campaign.id && sameServer(campaign, item))
                .map((item) => item.pic || "(tanpa PIC)")
                .join(", ")}{" "}
              di server yang sama.
            </span>
          </p>
        )}
        {changed && (
          <ol className="launch-adset-list">
            {plan.map((item) => (
              <li key={item.adSetId}>
                <span title={item.adSet}>{item.adSet || "(tanpa nama)"}</span>
                <small>
                  {formatDateTime(item.from)} → {formatDateTime(item.startTime)}
                </small>
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className="plugin-alert">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </p>
        )}
        <div className="confirm-actions">
          <button className="ghost-button" disabled={busy} onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={busy || !changed} type="submit">
            {busy ? "Menggeser..." : `Geser ${plan.length} ad set`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LaunchSlot({ slot, openKey, onToggle, canShift, onShift }) {
  return (
    <article className={`launch-slot${slot.clash ? " is-clash" : ""}`}>
      <header>
        <strong>{formatDateTime(slot.minute)}</strong>
        {slot.clash && (
          <span className="badge warning">
            <TriangleAlert size={12} /> {slot.clashCount} campaign mulai bersamaan di server yang
            sama
          </span>
        )}
        <small>{untilNote(slot.startMs)}</small>
      </header>
      <ul>
        {slot.campaigns.map((campaign) => {
          const key = `${slot.minute}|${campaign.id}`;
          const open = openKey === key;
          return (
            <li key={campaign.id}>
              <div className="launch-slot-row">
                <ExpandToggle
                  label={`ad set campaign ${campaign.campaign}`}
                  onToggle={() => onToggle(key)}
                  open={open}
                  title="Lihat ad set yang mulai di jam ini"
                />
                <div className="launch-slot-who">
                  <strong>{campaign.pic || "(tanpa PIC)"}</strong>
                  <span className={`badge ${campaign.campaignScheduled ? "info" : "neutral"}`}>
                    {campaign.level}
                  </span>
                </div>
                <div className="launch-slot-what">
                  <span className="launch-slot-name" title={campaign.campaign}>
                    {campaign.campaign || "-"}
                  </span>
                  <small>
                    {[
                      campaign.subDomain,
                      campaign.server ? `server ${campaign.server}` : "server tidak diketahui",
                      campaign.account,
                      campaign.adSetCount === campaign.adSetTotal
                        ? `${campaign.adSetCount} ad set`
                        : `${campaign.adSetCount} dari ${campaign.adSetTotal} ad set`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                {/* Hanya di campaign yang BENTROK (menit dan server yang sama): tombol di tiap baris
                    cuma mengundang penggeseran jadwal yang tidak mengganggu mesin mana pun. */}
                {campaign.clash && canShift(campaign) && (
                  <button className="ghost-button" onClick={() => onShift(campaign)} type="button">
                    Geser
                  </button>
                )}
              </div>
              {/* Hanya ad set yang mulai di MENIT kartu ini: sisanya berdiri di kartunya sendiri,
                  dan "2 dari 5 ad set" di atas sudah menyebut bahwa ada yang lain. */}
              {open && (
                <ol className="launch-adset-list">
                  {campaign.adSets.map((item) => (
                    <li key={item.adSetId || item.id}>
                      <span title={item.adSet}>{item.adSet || "(tanpa nama)"}</span>
                      <small>ID {item.adSetId || "-"}</small>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// "3 jam lagi" / "2 hari lagi" — jarak dari SEKARANG, supaya jadwal yang tinggal menit tidak
// terbaca sama dengan yang masih pekan depan.
function untilNote(startMs, now = Date.now()) {
  const minutes = Math.max(0, Math.round((startMs - now) / 60_000));
  if (minutes < 60) return `${minutes} menit lagi`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} jam lagi`;
  return `${Math.round(hours / 24)} hari lagi`;
}
