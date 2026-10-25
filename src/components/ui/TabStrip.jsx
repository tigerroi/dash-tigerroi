/**
 * Deret tab untuk satu panel yang memuat beberapa tabel.
 *
 * Ada karena panel yang ditumpuk memaksa scroll: tabel campaign 55 baris mendorong panel riwayat
 * jauh ke bawah layar, dan riwayat justru yang dibuka orang tepat setelah menekan Gate.
 *
 * Yang membuatnya tab sungguhan dan bukan sekadar dua tombol: role ARIA yang benar (`tablist` /
 * `tab` / `tabpanel` lewat `panelId`) dan panah kiri-kanan. Tanpa keduanya, pembaca layar
 * membacanya sebagai dua tombol lepas tanpa memberi tahu yang mana sedang aktif — dan tab adalah
 * pola yang sudah punya arti bawaan yang orang harapkan.
 */
export function TabStrip({ tabs, active, onChange, label = "Tab" }) {
  // Panah berpindah tab DAN mengaktifkannya sekaligus (automatic activation). Itu perilaku yang
  // benar untuk tab yang isinya sudah ada di memori: tidak ada yang perlu dimuat, jadi memaksa
  // Enter setelah panah hanya menambah satu tekanan tanpa mencegah apa pun.
  const onKeyDown = (event) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    if (index < 0) return;

    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;

    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(tabs[next].tabId)?.focus();
  };

  return (
    <div aria-label={label} className="tab-strip" onKeyDown={onKeyDown} role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            aria-controls={tab.panelId}
            aria-selected={selected}
            className={selected ? "tab-button active" : "tab-button"}
            id={tab.tabId}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            // Hanya tab yang aktif yang ikut urutan Tab. Yang lain dicapai lewat panah — kalau
            // tidak, keyboard harus melewati setiap tab satu per satu untuk sampai ke isinya.
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span>{tab.label}</span>
            {/* Jumlahnya di tab, bukan cuma di dalam tabelnya: yang membuat orang berpindah tab
                adalah tahu ada isinya di sana. */}
            {typeof tab.count === "number" && <span className="tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
