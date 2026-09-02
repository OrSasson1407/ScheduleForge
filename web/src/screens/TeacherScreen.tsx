/**
 * The one page a teacher account ever sees: every exam they teach, out of
 * their place's published schedule, matched by the instructor name(s) they
 * registered with (`auth/users.ts`'s `Account.instructorNames`) against
 * `Course.instructor` on each exam. Read-only, same as `StudentView` - the
 * two share their actual calendar rendering in
 * `components/PublishedScheduleCalendar.tsx` and differ only in what they
 * filter by and what they say about themselves.
 */

import { useCallback, useEffect, useState } from "react";
import { AccountMenu } from "../components/AccountMenu";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { PublishedScheduleCalendar } from "../components/PublishedScheduleCalendar";
import { useAuth } from "../auth/AuthContext";
import { fetchPublished } from "../auth/api";
import { useTranslation } from "../i18n/LanguageContext";
import { PublishedSchedule } from "../state/storage";

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function TeacherScreen() {
  const { t } = useTranslation();
  const { account } = useAuth();
  const [published, setPublished] = useState<PublishedSchedule | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "offline">("loading");

  const load = useCallback(async () => {
    const result = await fetchPublished();
    if (result === undefined) {
      setLoadState("offline");
    } else {
      setPublished(result);
      setLoadState("ready");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <span className="t-headline-md">
          {t("common.appName")} <span className="muted" style={{ fontWeight: 400 }}>v3.0</span>
        </span>
      </div>
      <div className="header-spacer" />
      <button type="button" className="icon-button" title={t("studentView.refresh")} onClick={load}>
        <Icon name="refresh" />
      </button>
      <LanguageToggle />
      <AccountMenu />
    </header>
  );

  if (loadState !== "ready" || !published) {
    return (
      <div className="app">
        {header}
        <div className="screen">
          <div className="panel">
            <div className="panel-title">
              <Icon name={loadState === "offline" ? "cloud_off" : "event_busy"} />
              <h2 className="t-section">{t("teacherView.title")}</h2>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              {loadState === "loading"
                ? t("studentView.loading")
                : loadState === "offline"
                ? t("auth.serverOffline")
                : t("studentView.nothingPublished")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const instructorNames = (account?.instructorNames ?? []).map(normalize);

  return (
    <div className="app">
      {header}
      <div className="output-main">
        <div className="system-nav">
          <div className="system-nav-title">
            <span className="t-headline-md">{t("teacherView.title")}</span>
            <span className="muted">
              {t("studentView.publishedAt", { time: new Date(published.publishedAt).toLocaleString() })}
            </span>
          </div>
        </div>

        <PublishedScheduleCalendar
          published={published}
          filterExam={(scheduled) => instructorNames.includes(normalize(scheduled.exam.course.instructor))}
        />
      </div>
    </div>
  );
}
