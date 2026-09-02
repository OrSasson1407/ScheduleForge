/**
 * The account identity and its actions, dropped from every signed-in
 * screen's header: display name, the list of this account's active sessions
 * (with "this device" told apart from the rest, and each of the others
 * revocable on its own), and sign out - one component instead of the bare
 * logout icon-button duplicated across `AdminScreen`, `TeacherScreen`,
 * `StudentView` and `App.tsx`.
 */

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useAuth } from "../auth/AuthContext";
import { SessionInfo, fetchSessions, revokeSession } from "../auth/api";
import { useTranslation } from "../i18n/LanguageContext";

export function AccountMenu() {
  const { t } = useTranslation();
  const { account, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSessions().then((result) => {
      if (cancelled || !result) return;
      setSessions(result.sessions);
      setCurrentId(result.currentId);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!account) return null;

  const revoke = async (id: string) => {
    setBusy(id);
    const ok = await revokeSession(id);
    if (ok) setSessions((current) => current?.filter((session) => session.id !== id) ?? null);
    setBusy(null);
  };

  return (
    <div className="account-menu">
      <button type="button" className="account-menu-trigger" onClick={() => setOpen(!open)}>
        <Icon name="account_circle" />
        <span className="t-data">{account.displayName}</span>
        <Icon name={open ? "expand_less" : "expand_more"} />
      </button>

      {open && (
        <div className="account-menu-panel">
          <h3 className="t-label muted">{t("account.sessionsTitle")}</h3>
          {sessions === null ? (
            <p className="hint">{t("account.sessionsLoading")}</p>
          ) : sessions.length <= 1 ? (
            <p className="hint">{t("account.sessionsNone")}</p>
          ) : (
            <ul className="admin-editor-list">
              {sessions.map((session) => (
                <li key={session.id} className="admin-editor-row">
                  <div>
                    <div className="t-data">{session.userAgent}</div>
                    <div className="hint">
                      {session.id === currentId ? t("account.thisDevice") : new Date(session.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {session.id !== currentId && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy === session.id}
                      onClick={() => revoke(session.id)}
                    >
                      <Icon name="close" />
                      {t("account.signOutDevice")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="secondary" onClick={logout}>
            <Icon name="logout" />
            {t("auth.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
