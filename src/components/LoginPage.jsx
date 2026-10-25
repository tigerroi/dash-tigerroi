import { Crown, Database, DollarSign, ShieldAlert, Sparkles, UserCheck } from "lucide-react";
import { useState } from "react";
import { Field } from "./ui/Field";

export function LoginPage({ onLogin, onLoginAsDemo, loading = false }) {
  const [form, setForm] = useState({ email: "", password: "" });

  const submit = (event) => {
    event.preventDefault();
    onLogin(form);
  };

  return (
    <main className="login-screen">
      <section className="login-card" style={{ maxWidth: "460px" }}>
        <div className="glow glow-blue" />
        <div className="glow glow-green" />
        <div className="login-content">
          <div className="login-mark">
            <Database size={20} />
          </div>
          <h1>TigerROI Dashboard</h1>
          <p>Pantau performa domain, iklan, dan pendapatan dari satu console.</p>

          <form onSubmit={submit} className="form-stack" style={{ marginTop: "1.5rem" }}>
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
              required
              placeholder="admin@tigerroi.com"
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(value) => setForm({ ...form, password: value })}
              required
              placeholder="********"
            />
            <button className="primary-button full" type="submit" disabled={loading}>
              {loading ? "Masuk..." : "Masuk"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
