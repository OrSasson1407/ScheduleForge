/**
 * The one page an admin account ever sees, now with two jobs instead of
 * one: creating the places (`auth/users.ts`'s `Place`) every other account
 * belongs to, and approving the editor accounts that register into them -
 * `server/index.js`'s `/api/editors/:username/approve` is still the only
 * way a new editor account actually becomes usable. Teacher and student
 * accounts need no approval (section on `server/store.js`'s `register`),
 * but still show up here, since a forgotten password anywhere still needs
 * an admin to reset it.
 */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthContext";
import { Account, Place } from "../auth/users";
import { approveEditor, createPlace, fetchAccounts, fetchPlaces, rejectEditor, resetPassword } from "../auth/api";
import { useTranslation } from "../i18n/LanguageContext";

export function AdminScreen() {
  const { t } = useTranslation();
  const { account, token, logout } = useAuth();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceKind, setNewPlaceKind] = useState("university");
  const [resetNotice, setResetNotice] = useState<{ username: string; temp: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [foundAccounts, foundPlaces] = await Promise.all([fetchAccounts(token), fetchPlaces()]);
    if (foundAccounts && foundPlaces) {
      setAccounts(foundAccounts);
      setPlaces(foundPlaces);
      setOffline(false);
    } else {
      setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const placeName = (placeId: string | null): string =>
    places?.find((place) => place.id === placeId)?.name ?? t("admin.unknownPlace");

  const addPlace = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !newPlaceName.trim()) return;
    setBusy("__new_place__");
    const created = await createPlace(token, newPlaceName.trim(), newPlaceKind);
    if (created) setNewPlaceName("");
    await load();
    setBusy(null);
  };

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

  const reset = async (username: string) => {
    if (!token) return;
    setBusy(username);
    const temp = await resetPassword(token, username);
    if (temp) setResetNotice({ username, temp });
    setBusy(null);
  };

  const editors = accounts?.filter((entry) => entry.role === "editor") ?? [];
  const pendingEditors = editors.filter((entry) => entry.status === "pending");
  const approvedEditors = editors.filter((entry) => entry.status === "approved");
  const others = accounts?.filter((entry) => entry.role === "teacher" || entry.role === "student") ?? [];

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
        {offline && (
          <div className="panel">
            <p className="error">{t("auth.serverOffline")}</p>
          </div>
        )}

        {resetNotice && (
          <div className="notice">
            {t("admin.tempPasswordNotice", { username: resetNotice.username, password: resetNotice.temp })}
            <button type="button" className="link-button" onClick={() => setResetNotice(null)}>
              {t("admin.dismiss")}
            </button>
          </div>
        )}

        <div className="panel">
          <div className="panel-title">
            <Icon name="corporate_fare" />
            <h2 className="t-section">{t("admin.placesTitle")}</h2>
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{t("admin.placesSubtitle")}</p>

          <form className="admin-place-form" onSubmit={addPlace}>
            <input
              type="text"
              placeholder={t("admin.placeNamePlaceholder")}
              value={newPlaceName}
              onChange={(event) => setNewPlaceName(event.target.value)}
            />
            <select value={newPlaceKind} onChange={(event) => setNewPlaceKind(event.target.value)}>
              <option value="university">{t("admin.kindUniversity")}</option>
              <option value="highschool">{t("admin.kindHighSchool")}</option>
              <option value="college">{t("admin.kindCollege")}</option>
              <option value="other">{t("admin.kindOther")}</option>
            </select>
            <button type="submit" className="primary" disabled={busy === "__new_place__" || !newPlaceName.trim()}>
              <Icon name="add" />
              {t("admin.addPlace")}
            </button>
          </form>

          {places && (
            <ul className="admin-editor-list" style={{ marginTop: 12 }}>
              {places.map((place) => (
                <li key={place.id} className="admin-editor-row">
                  <div>
                    <div className="t-data">{place.name}</div>
                    <div className="hint">{place.kind}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <Icon name="admin_panel_settings" />
            <h2 className="t-section">{t("admin.title")}</h2>
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{t("admin.subtitle")}</p>

          {accounts && (
            <>
              <h3 className="t-label muted" style={{ marginTop: 20 }}>
                {t("admin.pendingHeading", { count: pendingEditors.length })}
              </h3>
              {pendingEditors.length === 0 ? (
                <p className="hint">{t("admin.noPending")}</p>
              ) : (
                <ul className="admin-editor-list">
                  {pendingEditors.map((editor) => (
                    <li key={editor.username} className="admin-editor-row">
                      <div>
                        <div className="t-data">{editor.displayName}</div>
                        <div className="hint">
                          {editor.username} - {placeName(editor.placeId)}
                        </div>
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
                {t("admin.approvedHeading", { count: approvedEditors.length })}
              </h3>
              {approvedEditors.length === 0 ? (
                <p className="hint">{t("admin.noApproved")}</p>
              ) : (
                <ul className="admin-editor-list">
                  {approvedEditors.map((editor) => (
                    <li key={editor.username} className="admin-editor-row">
                      <div>
                        <div className="t-data">{editor.displayName}</div>
                        <div className="hint">
                          {editor.username} - {placeName(editor.placeId)}
                        </div>
                      </div>
                      <div className="admin-editor-actions">
                        <span className="badge">{t("admin.statusApproved")}</span>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy === editor.username}
                          onClick={() => reset(editor.username)}
                        >
                          <Icon name="password" />
                          {t("admin.resetPassword")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <Icon name="groups" />
            <h2 className="t-section">{t("admin.othersTitle")}</h2>
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{t("admin.othersSubtitle")}</p>

          {others.length === 0 ? (
            <p className="hint" style={{ marginTop: 12 }}>{t("admin.noOthers")}</p>
          ) : (
            <ul className="admin-editor-list" style={{ marginTop: 12 }}>
              {others.map((entry) => (
                <li key={entry.username} className="admin-editor-row">
                  <div>
                    <div className="t-data">{entry.displayName}</div>
                    <div className="hint">
                      {entry.username} - {placeName(entry.placeId)} -{" "}
                      {entry.role === "teacher"
                        ? t("admin.roleTeacherOf", { names: (entry.instructorNames ?? []).join(", ") })
                        : t("admin.roleStudentOf", { program: entry.program ?? "", year: entry.year ?? "" })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy === entry.username}
                    onClick={() => reset(entry.username)}
                  >
                    <Icon name="password" />
                    {t("admin.resetPassword")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
