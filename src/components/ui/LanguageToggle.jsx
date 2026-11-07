import { Globe } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

export function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className="language-toggle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: "var(--card-bg, #18191c)",
        border: "1px solid var(--border-color, #2a2e39)",
        borderRadius: "6px",
        padding: "2px",
        gap: "2px",
        fontSize: "12px",
        fontWeight: 600,
      }}
      title={lang === "id" ? "Ganti ke Bahasa Inggris" : "Switch to Indonesian"}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 4px",
          color: "var(--text-secondary, #94a3b8)",
        }}
      >
        <Globe size={13} />
      </div>
      <button
        type="button"
        onClick={() => setLang("id")}
        style={{
          padding: "2px 6px",
          borderRadius: "4px",
          border: "none",
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: lang === "id" ? 700 : 500,
          background: lang === "id" ? "var(--primary, #3b82f6)" : "transparent",
          color: lang === "id" ? "#ffffff" : "var(--text-secondary, #94a3b8)",
          transition: "all 0.15s ease",
        }}
      >
        ID
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        style={{
          padding: "2px 6px",
          borderRadius: "4px",
          border: "none",
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: lang === "en" ? 700 : 500,
          background: lang === "en" ? "var(--primary, #3b82f6)" : "transparent",
          color: lang === "en" ? "#ffffff" : "var(--text-secondary, #94a3b8)",
          transition: "all 0.15s ease",
        }}
      >
        EN
      </button>
    </div>
  );
}

