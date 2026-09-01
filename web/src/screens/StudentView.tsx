/**
 * The one page a viewer account ever sees: the exam schedule an editor chose
 * to publish, read-only. No Input, no Settings, none of `OutputScreen`'s
 * other tabs or edit abilities - a student does not choose a study program
 * here, or drag an exam, or run a search; they read the one calendar that is
 * meant for them.
 *
 * The published schedule is fetched from the server (`auth/api.ts`), not
 * read from this browser's own storage: a student opens this page on their
 * own computer, and the only way they can see what an editor published on a
 * different one is if the server is the thing holding it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { WeekCalendar } from "../components/WeekCalendar";
import { useAuth } from "../auth/AuthContext";
import { fetchPublished } from "../auth/api";
import { MOED_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";
import { ExamPeriod, ScheduledExam, isExcluded, toDisplayDate } from "../engine/model";
import { PublishedSchedule } from "../state/storage";
import { RoomAllocation, RoomAllocator } from "../engine/rooms";
import { assignTimes } from "../engine/timeAssignment";

function shorten(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

export function StudentView() {
  const { t } = useTranslation();
  const { account, token, logout } = useAuth();
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [published, setPublished] = useState<PublishedSchedule | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "offline">("loading");

  const load = useCallback(async () => {
    if (!token) return;
    const result = await fetchPublished(token);
    if (result === undefined) {
      setLoadState("offline");
    } else {
      setPublished(result);
      setLoadState("ready");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const roomAllocator = useMemo(
    () => (published && published.rooms.length ? new RoomAllocator(published.rooms, published.settings.defaultStudents) : null),
    [published]
  );
  const allocation: RoomAllocation | null = useMemo(
    () => (roomAllocator && published ? roomAllocator.allocate(published.system) : null),
    [roomAllocator, published]
  );
  const timeAssignment = useMemo(
    () => (published ? assignTimes(published.system, published.settings, allocation) : null),
    [published, allocation]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledExam[]>();
    if (!published) return map;
    for (const scheduled of published.system) {
      const list = map.get(scheduled.date) ?? [];
      list.push(scheduled);
      map.set(scheduled.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.exam.course.number.localeCompare(b.exam.course.number));
    }
    return map;
  }, [published]);

  const header = (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <span className="t-headline-md">
          {t("common.appName")} <span className="muted" style={{ fontWeight: 400 }}>v3.0</span>
        </span>
      </div>
      <div className="header-spacer" />
      <span className="t-data muted">{account?.displayName}</span>
      <button type="button" className="icon-button" title={t("studentView.refresh")} onClick={load}>
        <Icon name="refresh" />
      </button>
      <LanguageToggle />
      <button type="button" className="icon-button" title={t("auth.signOut")} onClick={logout}>
        <Icon name="logout" />
      </button>
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

  const { periods, selectedPrograms, programColors, programs } = published;
  const from = periods.reduce((min, p) => (p.startDate < min ? p.startDate : min), periods[0].startDate);
  const to = periods.reduce((max, p) => (p.endDate > max ? p.endDate : max), periods[0].endDate);

  const periodOfDay = (iso: string): ExamPeriod | undefined =>
    periods.find((period) => period.startDate <= iso && iso <= period.endDate);

  const dayClassName = (iso: string): string => {
    const period = periodOfDay(iso);
    return !period ? "outside" : isExcluded(period, iso) ? "excluded" : "";
  };

  const dayTitle = (iso: string): string | undefined => {
    const period = periodOfDay(iso);
    if (!period) return undefined;
    return t("output.dayTitle", {
      date: toDisplayDate(iso),
      semester: t(SEMESTER_KEY[period.semester]),
      moed: t(MOED_KEY[period.moed]),
    });
  };

  const toggleHighlight = (programNumber: string) => {
    setHighlighted((current) => {
      const next = new Set(current);
      if (next.has(programNumber)) next.delete(programNumber);
      else next.add(programNumber);
      return next;
    });
  };

  const renderDay = (iso: string) => {
    const scheduledExams = byDate.get(iso);
    if (!scheduledExams) return null;
    return (
      <>
        {scheduledExams.map((scheduled) => {
          const exam = scheduled.exam;
          const obligatory = exam.slots.some((slot) => slot.requirement === "Obligatory");
          const programList = [...new Set(exam.slots.map((slot) => slot.programNumber))];
          const chipRooms = allocation?.bookings.get(exam.id)?.rooms ?? [];
          const dimmed = highlighted.size > 0 && !programList.some((number) => highlighted.has(number));
          const litUp = highlighted.size > 0 && programList.some((number) => highlighted.has(number));
          const time = timeAssignment?.bookings.get(exam.id);
          return (
            <div
              key={exam.id}
              className={
                `exam-block ${!obligatory ? "elective" : ""}` +
                `${dimmed ? " chip-dim" : ""}${litUp ? " chip-lit" : ""}`
              }
            >
              <div className="exam-block-top">
                <span>{exam.course.number}</span>
                {time && <span className="exam-block-time">{time.start}</span>}
              </div>
              <div className="exam-block-name">{shorten(exam.course.name, 20)}</div>
              <div className="exam-block-dots">
                {programList.map((number) => (
                  <span key={number} className="dot" style={{ background: programColors[number] }} />
                ))}
              </div>
              <div className={`exam-tooltip ${!obligatory ? "is-elective" : ""}`}>
                <div className="exam-tooltip-kind">
                  {t(obligatory ? "output.tooltipObligatory" : "output.tooltipElective")}
                </div>
                <div className="exam-tooltip-title">{exam.course.name}</div>
                <div className="exam-tooltip-grid">
                  <div>{t("output.tooltipInstructor", { name: exam.course.instructor })}</div>
                  <div>{t("output.tooltipMoed", { moed: t(MOED_KEY[exam.moed]) })}</div>
                  <div>{t("output.tooltipPrograms", { list: programList.join(", ") })}</div>
                  {time && <div>{t("output.tooltipTime", { start: time.start, end: time.end })}</div>}
                  {chipRooms.length > 0 && (
                    <div>{t("output.tooltipRooms", { list: chipRooms.map((room) => room.name).join(", ") })}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="app">
      {header}
      <div className="output-main">
        <div className="system-nav">
          <div className="system-nav-title">
            <span className="t-headline-md">{t("studentView.title")}</span>
            <span className="muted">
              {t("studentView.publishedAt", { time: new Date(published.publishedAt).toLocaleString() })}
            </span>
          </div>
        </div>

        {selectedPrograms.length > 0 && (
          <div className="program-legend">
            <span className="t-label muted">{t("output.highlightLabel")}</span>
            {selectedPrograms.map((number) => {
              const program = programs.find((item) => item.number === number);
              const active = highlighted.has(number);
              return (
                <button
                  key={number}
                  type="button"
                  className={`legend-tag ${active ? "active" : ""}`}
                  onClick={() => toggleHighlight(number)}
                >
                  <span className="dot" style={{ background: programColors[number] }} />
                  {number} {program?.name ?? ""}
                </button>
              );
            })}
          </div>
        )}

        <div className="calendar-canvas">
          <WeekCalendar from={from} to={to} dayClassName={dayClassName} dayTitle={dayTitle} renderDay={renderDay} />
        </div>
      </div>
    </div>
  );
}
