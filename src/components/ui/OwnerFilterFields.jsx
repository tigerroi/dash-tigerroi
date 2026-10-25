import { SelectField, toSelectOptions } from "./SelectField";

/**
 * Tiga penyempit kepemilikan — advertiser, domain, subdomain — untuk dipakai di dalam FilterDialog.
 *
 * Berdiri sebagai komponen dan bukan disalin ke tiap dialog karena yang penting bukan ketiga
 * <select>-nya melainkan ATURAN DI ANTARANYA: memilih advertiser atau domain mengosongkan
 * subdomain. Disalin, salah satu tab akan lupa mengosongkannya suatu hari — dan yang terjadi
 * adalah dua filter yang saling meniadakan, yang hasilnya kalender kosong tanpa satu pun sebab
 * yang terbaca di layar.
 */
export function OwnerFilterFields({
  advertiser,
  advertiserLabel = "Advertiser",
  advertiserOptions,
  domain,
  domainOptions,
  onAdvertiser,
  onDomain,
  onSubDomain,
  subDomain,
  subDomainOptions,
}) {
  return (
    <>
      <div className="filter-dialog-field">
        <span>{advertiserLabel}</span>
        <SelectField
          ariaLabel={advertiserLabel}
          value={advertiser}
          onChange={(next) => {
            onAdvertiser(next);
            onSubDomain("");
          }}
          options={[
            { value: "", label: `Semua ${advertiserLabel}` },
            ...toSelectOptions(advertiserOptions),
          ]}
        />
      </div>
      <div className="filter-dialog-field">
        <span>Domain</span>
        <SelectField
          ariaLabel="Domain"
          value={domain}
          onChange={(next) => {
            onDomain(next);
            // Subdomain yang dipilih bisa saja bukan milik domain baru ini, dan filter yang saling
            // meniadakan menghasilkan panel kosong tanpa sebab yang terbaca.
            onSubDomain("");
          }}
          options={[{ value: "", label: "Semua Domain" }, ...toSelectOptions(domainOptions)]}
        />
      </div>
      <div className="filter-dialog-field">
        <span>Subdomain</span>
        <SelectField
          ariaLabel="Subdomain"
          value={subDomain}
          onChange={onSubDomain}
          options={[{ value: "", label: "Semua Subdomain" }, ...toSelectOptions(subDomainOptions)]}
        />
      </div>
    </>
  );
}
