/**
 * The one screen every visitor sees before any other: who they are decides
 * whether they reach the admin's approval list, one place's full
 * application, or a read-only view scoped to them (`AppGate.tsx` makes that
 * choice once signed in). An instructor, teacher or student who does not
 * have an account yet can switch this same card to registration, where they
 * pick which of the three roles they are and which place (`auth/users.ts`'s
 * `Place`) they belong to - see `auth/AuthContext.tsx` and `server/index.js`
 * for why that has to be resolved by the server rather than in this browser
 * alone.
 */

import { FormEvent, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth/AuthContext";
import { fetchPlaces } from "../auth/api";
import { Place } from "../auth/users";
import { useTranslation } from "../i18n/LanguageContext";

type Mode = "login" | "register";
type RegisterRole = "editor" | "teacher" | "student";
type Notice =
  | { kind: "wrongCredentials" | "pendingApproval" | "offline" | "registerTaken" | "registerFailed" | "noPlaces" }
  | { kind: "registeredPending" | "registeredApproved" }
  | null;

export function LoginScreen() {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<RegisterRole>("editor");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placeId, setPlaceId] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [program, setProgram] = useState("");
  const [year, setYear] = useState(1);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "register" || places !== null) return;
    fetchPlaces().then((found) => {
      setPlaces(found ?? []);
      if (found && found.length && !placeId) setPlaceId(found[0].id);
    });
  }, [mode, places, placeId]);

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
      if (!placeId) {
        setNotice({ kind: "noPlaces" });
        setBusy(false);
        return;
      }
      const outcome = await register({
        username,
        password,
        displayName,
        role,
        placeId,
        instructorNames: role === "teacher" ? [instructorName.trim()] : undefined,
        program: role === "student" ? program.trim() : undefined,
        year: role === "student" ? year : undefined,
      });
      if (outcome === "ok") {
        setNotice({ kind: role === "editor" ? "registeredPending" : "registeredApproved" });
        setPassword("");
      } else if (outcome === "taken") setNotice({ kind: "registerTaken" });
      else if (outcome === "offline") setNotice({ kind: "offline" });
      else setNotice({ kind: "registerFailed" });
    }
    setBusy(false);
  };

  const canSubmit =
    !busy &&
    username.trim() &&
    password &&
    (mode === "login" ||
      (displayName.trim() &&
        placeId &&
        (role !== "teacher" || instructorName.trim()) &&
        (role !== "student" || program.trim())));

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
          <>
            <label className="login-field">
              {t("auth.displayName")}
              <input
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>

            <fieldset className="role-choice">
              <legend>{t("auth.iAmA")}</legend>
              {(["editor", "teacher", "student"] as const).map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="register-role"
                    checked={role === option}
                    onChange={() => setRole(option)}
                  />
                  {t(option === "editor" ? "auth.roleEditor" : option === "teacher" ? "auth.roleTeacher" : "auth.roleStudent")}
                </label>
              ))}
            </fieldset>

            <label className="login-field">
              {t("auth.place")}
              {places && places.length > 0 ? (
                <select value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
                  {places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="hint">{places === null ? t("auth.loadingPlaces") : t("auth.noPlacesYet")}</span>
              )}
            </label>

            {role === "teacher" && (
              <label className="login-field">
                {t("auth.instructorName")}
                <input
                  type="text"
                  value={instructorName}
                  onChange={(event) => setInstructorName(event.target.value)}
                  placeholder={t("auth.instructorNameHint")}
                />
              </label>
            )}

            {role === "student" && (
              <div className="login-field-row">
                <label className="login-field">
                  {t("auth.studentProgram")}
                  <input type="text" value={program} onChange={(event) => setProgram(event.target.value)} />
                </label>
                <label className="login-field">
                  {t("auth.studentYear")}
                  <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                    {[1, 2, 3, 4].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </>
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
        {notice?.kind === "noPlaces" && <p className="error">{t("auth.noPlacesYet")}</p>}
        {notice?.kind === "registeredPending" && <p className="success-text">{t("auth.registeredPending")}</p>}
        {notice?.kind === "registeredApproved" && <p className="success-text">{t("auth.registeredApproved")}</p>}

        <button type="submit" className="primary" disabled={!canSubmit}>
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
