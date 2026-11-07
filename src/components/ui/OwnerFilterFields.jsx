import { SelectField, toSelectOptions } from "./SelectField";
import { useLanguage } from "../../context/LanguageContext";

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
  formatSubDomain,
}) {
  const { t } = useLanguage();

  const labelKey = advertiserLabel.toLowerCase();
  const allAdvertiserLabel = advertiserLabel === "PIC"
    ? t("semua pic", "Semua PIC")
    : t(`semua ${labelKey}`, `Semua ${advertiserLabel}`);

  return (
    <>
      <div className="filter-dialog-field">
        <span>{t(advertiserLabel, advertiserLabel)}</span>
        <SelectField
          ariaLabel={t(advertiserLabel, advertiserLabel)}
          value={advertiser}
          onChange={(next) => {
            onAdvertiser(next);
            onSubDomain("");
          }}
          options={[
            { value: "", label: allAdvertiserLabel },
            ...toSelectOptions(advertiserOptions),
          ]}
        />
      </div>
      <div className="filter-dialog-field">
        <span>{t("domain", "Domain")}</span>
        <SelectField
          ariaLabel={t("domain", "Domain")}
          value={domain}
          onChange={(next) => {
            onDomain(next);
            // Subdomain yang dipilih bisa saja bukan milik domain baru ini, dan filter yang saling
            // meniadakan menghasilkan panel kosong tanpa sebab yang terbaca.
            onSubDomain("");
          }}
          options={[{ value: "", label: t("semua domain", "Semua Domain") }, ...toSelectOptions(domainOptions)]}
        />
      </div>
      <div className="filter-dialog-field">
        <span>{t("subdomain", "Subdomain")}</span>
        <SelectField
          ariaLabel={t("subdomain", "Subdomain")}
          value={subDomain}
          onChange={onSubDomain}
          options={[
            { value: "", label: t("semua subdomain", "Semua Subdomain") },
            ...toSelectOptions(subDomainOptions, formatSubDomain),
          ]}
        />
      </div>
    </>
  );
}
