/**
 * Shown instead of any role's normal screen whenever `Account.mustChangePassword`
 * is true - the one state a reset password (`AdminScreen`'s "Reset password")
 * leaves an account in. Changing the password succeeds or fails; there is no
 * "skip this" - the account was reset because someone other than its owner
 * asked for that, and its temporary password should not go on being used any
 * longer than it takes to replace it.
 *
 * `changePassword` revokes every session for the account, including the one
 * this very request is made with (`server/store.js`'s `changePassword`), so
 * success here signs the browser back out - the natural next step is signing
 * in again with the new password, not staying on a session that server no
 * longer recognizes.
 */

import { FormEvent, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthContext";
import { changePassword } from "../auth/api";
import { useTranslation } from "../i18n/LanguageContext";

export function ChangePasswordScreen() {
  const { t } = useTranslation();
  const { token, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    const outcome = await changePassword(token, currentPassword, newPassword);
    setBusy(false);
    if (outcome === "ok") {
      logout(); // the server already revoked this session; reflect that locally and return to sign-in
      return;
    }
    setError(
      outcome === "wrongCurrent"
        ? t("auth.wrongCredentials")
        : outcome === "offline"
        ? t("auth.serverOffline")
        : t("auth.changePasswordTooShort")
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
        <h1 className="t-headline-lg">{t("auth.changePasswordTitle")}</h1>
        <p className="hint">{t("auth.changePasswordSubtitle")}</p>

        <label className="login-field">
          {t("auth.changePasswordCurrent")}
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label className="login-field">
          {t("auth.changePasswordNew")}
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary" disabled={busy || !currentPassword || !newPassword}>
          <Icon name="password" />
          {t("auth.changePasswordSubmit")}
        </button>
        <button type="button" className="link-button" onClick={logout}>
          {t("auth.signOut")}
        </button>
      </form>
    </div>
  );
}
