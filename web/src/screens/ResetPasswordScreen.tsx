/**
 * Where the link in a forgot-password email lands: `AppGate.tsx` renders
 * this instead of its normal sign-in/app choice whenever the URL carries a
 * `resetToken` query parameter, since there is no router in this app to give
 * it a route of its own (see `AppGate.tsx`'s own comment on why). The token
 * itself is opaque here - `server/index.js`'s `/api/reset-password/confirm`
 * is what actually validates it, once, when the form is submitted.
 */

import { FormEvent, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { confirmPasswordReset } from "../auth/api";
import { useTranslation } from "../i18n/LanguageContext";

interface Props {
  token: string;
  onDone: () => void;
}

export function ResetPasswordScreen({ token, onDone }: Props) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const outcome = await confirmPasswordReset(token, newPassword);
    setBusy(false);
    if (outcome === "ok") {
      setDone(true);
      return;
    }
    setError(
      outcome === "offline"
        ? t("auth.serverOffline")
        : outcome === "tooWeak"
        ? t("auth.changePasswordTooShort")
        : t("auth.resetPasswordInvalid")
    );
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
        <h1 className="t-headline-lg">{t("auth.resetPasswordTitle")}</h1>
        <p className="hint">{t("auth.resetPasswordSubtitle")}</p>

        {done ? (
          <>
            <p className="success-text">{t("auth.resetPasswordSuccess")}</p>
            <button type="button" className="primary" onClick={onDone}>
              <Icon name="login" />
              {t("auth.backToSignIn")}
            </button>
          </>
        ) : (
          <>
            <label className="login-field">
              {t("auth.resetPasswordNew")}
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button type="submit" className="primary" disabled={busy || !newPassword}>
              <Icon name="password" />
              {t("auth.resetPasswordSubmit")}
            </button>
            <button type="button" className="link-button" onClick={onDone}>
              {t("auth.backToSignIn")}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
