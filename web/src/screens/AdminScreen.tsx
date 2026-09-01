/**
 * The one page an admin account ever sees: every editor that has registered,
 * pending ones first, with the approve action that is the only way a new
 * editor account actually becomes usable (`server/index.js`'s
 * `/api/editors/:username/approve`). There is nothing else to administer
 * here on purpose - see `auth/AuthContext.tsx` for how this role fits with
 * `editor` and `viewer`.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthContext";
import { Account } from "../auth/users";
import { approveEditor, fetchEditors, rejectEditor } from "../auth/api";
import { useTranslation } from "../i18n/LanguageContext";

export function AdminScreen() {
  const { t } = useTranslation();
  const { account, token, logout } = useAuth();
  const [editors, setEditors] = useState<Account[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const found = await fetchEditors(token);
    if (found) {
      setEditors(found);
      setOffline(false);
    } else {
      setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (username: string) => {
    if (!token) return;
    setBusy(username);
    await approveEditor(token, username);
    await load();
    setBusy(null);
  };

  const reject = async (username: string) => {
    if (!token) return;
    setBusy(username);
    await rejectEditor(token, username);
    await load();
    setBusy(null);
  };

  const pending = editors?.filter((editor) => editor.status === "pending") ?? [];
  const approved = editors?.filter((editor) => editor.status === "approved") ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Logo />
          <span className="t-headline-md">
            {t("common.appName")} <span className="muted" style={{ fontWeight: 400 }}>v3.0</span>
          </span>
        </div>
        <div className="header-spacer" />
        <span className="t-data muted">{account?.displayName}</span>
        <LanguageToggle />
        <button type="button" className="icon-button" title={t("auth.signOut")} onClick={logout}>
          <Icon name="logout" />
        </button>
      </header>
      <div className="screen">
        <div className="panel">
          <div className="panel-title">
            <Icon name="admin_panel_settings" />
            <h2 className="t-section">{t("admin.title")}</h2>
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{t("admin.subtitle")}</p>

          {offline && <p className="error" style={{ marginTop: 12 }}>{t("auth.serverOffline")}</p>}

          {editors && (
            <>
              <h3 className="t-label muted" style={{ marginTop: 20 }}>
                {t("admin.pendingHeading", { count: pending.length })}
              </h3>
              {pending.length === 0 ? (
                <p className="hint">{t("admin.noPending")}</p>
              ) : (
                <ul className="admin-editor-list">
                  {pending.map((editor) => (
                    <li key={editor.username} className="admin-editor-row">
                      <div>
                        <div className="t-data">{editor.displayName}</div>
                        <div className="hint">{editor.username}</div>
                      </div>
                      <div className="admin-editor-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={busy === editor.username}
                          onClick={() => approve(editor.username)}
                        >
                          <Icon name="check" />
                          {t("admin.approve")}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy === editor.username}
                          onClick={() => reject(editor.username)}
                        >
                          <Icon name="close" />
                          {t("admin.reject")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="t-label muted" style={{ marginTop: 20 }}>
                {t("admin.approvedHeading", { count: approved.length })}
              </h3>
              {approved.length === 0 ? (
                <p className="hint">{t("admin.noApproved")}</p>
              ) : (
                <ul className="admin-editor-list">
                  {approved.map((editor) => (
                    <li key={editor.username} className="admin-editor-row">
                      <div>
                        <div className="t-data">{editor.displayName}</div>
                        <div className="hint">{editor.username}</div>
                      </div>
                      <span className="badge">{t("admin.statusApproved")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
