/**
 * The one screen every visitor sees before any other: who they are decides
 * whether they reach the admin's approval list, the full application, or
 * only the published schedule (`AppGate.tsx` makes that choice once signed
 * in). An instructor who does not have an account yet can switch this same
 * card to registration; what they get back is a pending account, not a
 * session - see `auth/AuthContext.tsx` and `server/index.js` for why that
 * approval has to happen on the server rather than in this browser alone.
 */

import { FormEvent, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthContext";
import { useTranslation } from "../i18n/LanguageContext";

type Mode = "login" | "register";
type Notice =
  | { kind: "wrongCredentials" | "pendingApproval" | "offline" | "registerTaken" | "registerFailed" }
  | { kind: "registeredPending" }
  | null;

export function LoginScreen() {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setNotice(null);
    setPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (mode === "login") {
      const outcome = await login(username, password);
      if (outcome === "ok") setNotice(null);
      else if (outcome === "pending") setNotice({ kind: "pendingApproval" });
      else if (outcome === "offline") setNotice({ kind: "offline" });
      else setNotice({ kind: "wrongCredentials" });
    } else {
      const outcome = await register(username, password, displayName);
      if (outcome === "ok") {
        setNotice({ kind: "registeredPending" });
        setPassword("");
      } else if (outcome === "taken") setNotice({ kind: "registerTaken" });
      else if (outcome === "offline") setNotice({ kind: "offline" });
      else setNotice({ kind: "registerFailed" });
    }
    setBusy(false);
  };

  return (
    <div className="login-shell">
      <div className="login-topbar">
        <LanguageToggle />
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <Logo />
          <span className="t-headline-md">{t("common.appName")}</span>
        </div>
        <h1 className="t-headline-lg">{mode === "login" ? t("auth.title") : t("auth.registerTitle")}</h1>
        <p className="hint">{mode === "login" ? t("auth.subtitle") : t("auth.registerSubtitle")}</p>

        {mode === "register" && (
          <label className="login-field">
            {t("auth.displayName")}
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}
        <label className="login-field">
          {t("auth.username")}
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="login-field">
          {t("auth.password")}
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {notice?.kind === "wrongCredentials" && <p className="error">{t("auth.wrongCredentials")}</p>}
        {notice?.kind === "pendingApproval" && <p className="error">{t("auth.pendingApproval")}</p>}
        {notice?.kind === "offline" && <p className="error">{t("auth.serverOffline")}</p>}
        {notice?.kind === "registerTaken" && <p className="error">{t("auth.registerTaken")}</p>}
        {notice?.kind === "registerFailed" && <p className="error">{t("auth.registerFailed")}</p>}
        {notice?.kind === "registeredPending" && <p className="success-text">{t("auth.registeredPending")}</p>}

        <button
          type="submit"
          className="primary"
          disabled={busy || !username.trim() || !password || (mode === "register" && !displayName.trim())}
        >
          <Icon name={mode === "login" ? "login" : "how_to_reg"} />
          {mode === "login" ? t("auth.signIn") : t("auth.registerSubmit")}
        </button>

        {mode === "login" ? (
          <>
            <p className="hint login-demo">{t("auth.demoAccounts")}</p>
            <button type="button" className="link-button" onClick={() => switchMode("register")}>
              {t("auth.switchToRegister")}
            </button>
          </>
        ) : (
          <button type="button" className="link-button" onClick={() => switchMode("login")}>
            {t("auth.switchToLogin")}
          </button>
        )}
      </form>
    </div>
  );
}
