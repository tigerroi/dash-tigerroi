import { useLanguage } from "../../context/LanguageContext";

export function PageHeader({ title, description, action }) {
  const { t } = useLanguage();
  return (
    <header className="page-header">
      <div>
        <h1>{typeof title === "string" ? t(title, title) : title}</h1>
        {description && (
          <p>{typeof description === "string" ? t(description, description) : description}</p>
        )}
      </div>
      {action}
    </header>
  );
}
