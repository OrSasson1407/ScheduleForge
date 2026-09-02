/**
 * The one page a student account ever sees: the exams that apply to their
 * study program and year, out of their place's published schedule
 * (`PublishedScheduleCalendar` does the actual filtering and drawing). No
 * Input, no Settings, none of `OutputScreen`'s other tabs or edit abilities -
 * a student does not choose a study program here, or drag an exam, or run a
 * search; they read the one calendar that is meant for them.
 *
 * The published schedule is fetched from the server (`auth/api.ts`), not
 * read from this browser's own storage: a student opens this page on their
 * own computer, and the only way they can see what an editor published on a
 * different one is if the server is the thing holding it.
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

export function StudentView() {
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
              <h2 className="t-section">{t("studentView.title")}</h2>
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

  return (
    <div className="app">
      {header}
      <div className="output-main">
        <div className="system-nav">
          <div className="system-nav-title">
            <span className="t-headline-md">
              {t("studentView.title")}
              {account?.program && (
                <span className="muted"> · {account.program} · {t("programs.yearLabel", { year: account.year ?? 1 })}</span>
              )}
            </span>
            <span className="muted">
              {t("studentView.publishedAt", { time: new Date(published.publishedAt).toLocaleString() })}
            </span>
          </div>
        </div>

        <PublishedScheduleCalendar
          published={published}
          filterExam={(scheduled) =>
            scheduled.exam.slots.some(
              (slot) => slot.programNumber === account?.program && slot.year === account?.year
            )
          }
        />
      </div>
    </div>
  );
}
