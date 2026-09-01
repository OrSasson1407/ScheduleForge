/**
 * The very first thing that decides what a visitor sees: signed out gets the
 * login/registration card, an admin gets their one approval page, an editor
 * gets the full application, and a viewer gets the published schedule only.
 * See `auth/AuthContext.tsx` for how the session behind this is kept, and
 * its header comment (and `server/index.js`'s) for what it can and cannot
 * actually secure - there is no server standing between a curious visitor and
 * the editor screens except this check.
 */

import { useTranslation } from "./i18n/LanguageContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AdminScreen } from "./screens/AdminScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { StudentView } from "./screens/StudentView";
import App from "./App";

function Gate() {
  const { t } = useTranslation();
  const { account, restoring } = useAuth();

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
  if (account.role === "admin") return <AdminScreen />;
  if (account.role === "viewer") return <StudentView />;
  return <App />;
}

export function AppGate() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
