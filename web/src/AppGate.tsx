/**
 * The very first thing that decides what a visitor sees: signed out gets the
 * login/registration card, an admin (global or place-scoped) gets their
 * approval page, an editor gets the full application, and a viewer gets the
 * published schedule only. See `auth/AuthContext.tsx` for how the session
 * behind this is kept, and its header comment (and `server/index.js`'s) for
 * what it can and cannot actually secure - there is no server standing
 * between a curious visitor and the editor screens except this check.
 *
 * One more case sits ahead of all of it: a `?resetToken=` in the URL, the
 * shape of the link `server/email.js` sends in a forgot-password email.
 * There is no router anywhere in this app, so rather than add one for a
 * single one-off screen, this reads the query string directly and swaps in
 * `ResetPasswordScreen` regardless of whatever else is signed in or
 * restoring - a person who followed that link wants exactly one thing.
 */

import { useState } from "react";
import { useTranslation } from "./i18n/LanguageContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AdminScreen } from "./screens/AdminScreen";
import { ChangePasswordScreen } from "./screens/ChangePasswordScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { ResetPasswordScreen } from "./screens/ResetPasswordScreen";
import { StudentView } from "./screens/StudentView";
import { TeacherScreen } from "./screens/TeacherScreen";
import App from "./App";

function resetTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("resetToken");
}

function Gate() {
  const { t } = useTranslation();
  const { account, restoring } = useAuth();
  const [resetToken, setResetToken] = useState<string | null>(resetTokenFromUrl);

  if (resetToken) {
    return (
      <ResetPasswordScreen
        token={resetToken}
        onDone={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("resetToken");
          window.history.replaceState({}, "", url);
          setResetToken(null);
        }}
      />
    );
  }

  if (restoring) {
    return (
      <div className="app">
        <div className="screen">
          <p className="hint">{t("auth.restoring")}</p>
        </div>
      </div>
    );
  }

  if (!account) return <LoginScreen />;
  if (account.mustChangePassword) return <ChangePasswordScreen />;
  if (account.role === "admin" || account.role === "placeAdmin") return <AdminScreen />;
  if (account.role === "teacher") return <TeacherScreen />;
  if (account.role === "student") return <StudentView />;
  return <App />;
}

export function AppGate() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
