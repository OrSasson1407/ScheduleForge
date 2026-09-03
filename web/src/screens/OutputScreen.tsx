/**
 * The output screen (requirement 3 of version 2.0, section 3 of version 3.0).
 *
 * 3.1 one exam system at a time, as a year calendar of the whole exam period,
 * 3.2 a bar that moves to the next system or to the previous one,
 * 3.3 how many systems were found and which one is shown,
 * 3.4 course number, course name, obligatory/elective and program per exam,
 * 3.5 the system that is shown can be saved to a readable file.
 *
 * The sidebar splits that into four views of the same system: the week
 * calendar (Overview), the numbers behind it (Metrics), where every exam sits
 * (Rooms), and the files it can be turned into (Export) - four readings of one
 * `workingSystem`, never four different systems.
 *
 * This version adds three more things, all about the system that is on screen
 * rather than about finding it:
 *
 * - dragging an exam to another day edits it directly. Only the days that keep
 *   every rule of section 2 met light up while the drag is in the air, exactly
 *   the way the search itself would judge that date;
 * - a colour tag per study program, shown on every exam block; clicking a tag
 *   in the legend dims every other exam and keeps that program's exams full
 *   strength;
 * - when a collaboration room is joined, a chip someone else is dragging is
 *   shown locked and cannot be dragged locally, and a move made here is sent
 *   to everyone else in the room the moment it lands.
 */

import { useMemo, useState } from "react";
import { WeekCalendar } from "../components/WeekCalendar";
import { Icon } from "../components/Icon";
import { CollabLocks } from "../collab/useCollab";
import { BenchmarkRun } from "../engine/benchmarks";
import { StudyProgram } from "../engine/catalog";
import { ProgramColors } from "../engine/colors";
import { legalDatesFor } from "../engine/edit";
import { Candidate, SearchReport, describeSearch } from "../engine/generator";
import { calendarsOf } from "../engine/ics";
import {
  EnrollmentRoster,
  Exam,
  ExamPeriod,
  ExamSystem,
  FacultyRules,
  Room,
  ScheduledExam,
  isExcluded,
  toDisplayDate,
} from "../engine/model";
import { NotificationDraft, diffSystems, draftsFor } from "../engine/notify";
import { downloadText, formatSystem } from "../engine/format";
import { SystemMetrics, measure, passesThresholds } from "../engine/quality";
import { RoomAllocation, RoomAllocator } from "../engine/rooms";
import { Settings, describeThresholds } from "../engine/settings";
import { TimeAssignment, assignTimes } from "../engine/timeAssignment";
import { MOED_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";
import { TranslationKey } from "../i18n/types";

interface Props {
  candidates: Candidate[];
  report: SearchReport;
  periods: ExamPeriod[];
  rooms: Room[];
  faculty: FacultyRules;
  roster: EnrollmentRoster;
  programs: StudyProgram[];
  selectedPrograms: string[];
  programColors: ProgramColors;
  settings: Settings;
  index: number;
  onIndexChange: (index: number) => void;
  workingSystem: ExamSystem | null;
  onMoveExam: (exam: Exam, date: string) => void;
  onResetSystem: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  collabConnected: boolean;
  collabLocks: CollabLocks;
  myClientId: string | null;
  collabNotice: string | null;
  /** False while connected to a collaboration room as a viewer: dragging is disabled. */
  isEditor: boolean;
  onRequestLock: (examId: string) => void;
  onReleaseLock: (examId: string) => void;
  benchmarks: BenchmarkRun[];
  onClearBenchmarks: () => void;
  /** Sends this exam system to the server as the one students see. Resolves to whether it worked. */
  onPublish: (system: ExamSystem) => Promise<boolean>;
  onBack: () => void;
}

interface DragState {
  examId: string;
  legalDates: Set<string>;
}

type SidebarTab = "overview" | "metrics" | "rooms" | "compare" | "benchmarks" | "export";

const SIDEBAR_TABS: { key: SidebarTab; labelKey: TranslationKey; icon: string }[] = [
  { key: "overview", labelKey: "output.tabOverview", icon: "dashboard" },
  { key: "metrics", labelKey: "output.tabMetrics", icon: "analytics" },
  { key: "rooms", labelKey: "output.tabRooms", icon: "meeting_room" },
  { key: "compare", labelKey: "output.tabCompare", icon: "compare_arrows" },
  { key: "benchmarks", labelKey: "output.tabBenchmarks", icon: "speed" },
  { key: "export", labelKey: "output.tabExport", icon: "file_download" },
];

/** Every exam whose course number, name or instructor matches the query. */
function matchingExamIds(system: ExamSystem, query: string): Set<string> {
  const needle = query.trim().toLowerCase();
  if (!needle) return new Set();
  const ids = new Set<string>();
  for (const scheduled of system) {
    const course = scheduled.exam.course;
    if (
      course.number.toLowerCase().includes(needle) ||
      course.name.toLowerCase().includes(needle) ||
      course.instructor.toLowerCase().includes(needle)
    ) {
      ids.add(scheduled.exam.id);
    }
  }
  return ids;
}

function shorten(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/** Average, across the days that hold an exam, of seats needed / seats available. */
function roomUtilization(system: ExamSystem, allocator: RoomAllocator | null): number | null {
  if (!allocator || !system.length || !allocator.totalCapacity) return null;
  const byDate = new Map<string, number>();
  for (const scheduled of system) {
    byDate.set(scheduled.date, (byDate.get(scheduled.date) ?? 0) + allocator.studentsOf(scheduled.exam));
  }
  const ratios = [...byDate.values()].map((seats) => Math.min(seats / allocator.totalCapacity, 1));
  return (ratios.reduce((sum, value) => sum + value, 0) / ratios.length) * 100;
}

export function OutputScreen({
  candidates,
  report,
  periods,
  rooms,
  faculty,
  roster,
  programs,
  selectedPrograms,
  programColors,
  settings,
  index,
  onIndexChange,
  workingSystem,
  onMoveExam,
  onResetSystem,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  collabConnected,
  collabLocks,
  myClientId,
  collabNotice,
  isEditor,
  onRequestLock,
  onReleaseLock,
  benchmarks,
  onClearBenchmarks,
  onPublish,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const candidate = candidates[Math.min(index, candidates.length - 1)] as Candidate | undefined;
  const system = workingSystem ?? candidate?.system ?? [];
  const [drag, setDrag] = useState<DragState | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<SidebarTab>("overview");
  const [query, setQuery] = useState("");
  const [compareAt, setCompareAt] = useState(0);
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "done" | "error">("idle");

  const wasEdited = candidate ? system !== candidate.system : false;

  const roomAllocator = useMemo(
    () => (rooms.length ? new RoomAllocator(rooms, settings.defaultStudents) : null),
    [rooms, settings.defaultStudents]
  );
  const metrics = useMemo(() => measure(system, settings.windowDays), [system, settings.windowDays]);
  const allocation = useMemo(
    () => (roomAllocator ? roomAllocator.allocate(system) : null),
    [roomAllocator, system]
  );
  const utilization = useMemo(() => roomUtilization(system, roomAllocator), [system, roomAllocator]);
  const timeAssignment: TimeAssignment = useMemo(
    () => assignTimes(system, settings, allocation, roster),
    [system, settings, allocation, roster]
  );
  const matched = useMemo(() => matchingExamIds(system, query), [system, query]);
  const scheduleChanges = useMemo(
    () => (candidate ? diffSystems(candidate.system, system, selectedPrograms) : []),
    [candidate, system, selectedPrograms]
  );
  const notifyDrafts: NotificationDraft[] = useMemo(
    () => draftsFor(scheduleChanges, programs),
    [scheduleChanges, programs]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledExam[]>();
    for (const scheduled of system) {
      const list = map.get(scheduled.date) ?? [];
      list.push(scheduled);
      map.set(scheduled.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.exam.course.number.localeCompare(b.exam.course.number));
    }
    return map;
  }, [system]);

  const calendars = useMemo(
    () => calendarsOf(system, selectedPrograms, programs, allocation),
    [system, selectedPrograms, programs, allocation]
  );

  if (!periods.length || !candidate) {
    return (
      <div className="screen">
        <div className="panel">
          <div className="panel-title">
            <Icon name="event_busy" />
            <h2 className="t-section">{t("output.notFoundTitle")}</h2>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {t("output.notFoundHint", { detail: describeSearch(report, 0) })}
          </p>
          {describeThresholds(settings).length > 0 && (
            <ul className="hint">
              {describeThresholds(settings).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onBack} style={{ marginTop: 10 }}>
            {t("output.backToSettings")}
          </button>
        </div>
      </div>
    );
  }

  const from = periods.reduce((min, p) => (p.startDate < min ? p.startDate : min), periods[0].startDate);
  const to = periods.reduce((max, p) => (p.endDate > max ? p.endDate : max), periods[0].endDate);

  const periodOfDay = (iso: string): ExamPeriod | undefined =>
    periods.find((period) => period.startDate <= iso && iso <= period.endDate);

  const dayClassName = (iso: string): string => {
    const period = periodOfDay(iso);
    const base = !period ? "outside" : isExcluded(period, iso) ? "excluded" : "";
    if (!drag) return base;
    if (drag.legalDates.has(iso)) return `${base} dnd-legal`;
    if (period && !isExcluded(period, iso)) return `${base} dnd-illegal`;
    return base;
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

  const startDrag = (scheduled: ScheduledExam) => {
    if (!isEditor) return; // a viewer in a collaboration room watches only
    const exam = scheduled.exam;
    const holder = collabLocks[exam.id];
    if (holder && holder.clientId !== myClientId) return; // someone else is already dragging it
    if (collabConnected) onRequestLock(exam.id);
    const legalDates = legalDatesFor({ exam, system, periods, settings, faculty, roomAllocator, roster });
    setDrag({ examId: exam.id, legalDates });
  };

  const endDrag = () => {
    if (drag && collabConnected) onReleaseLock(drag.examId);
    setDrag(null);
  };

  const dropOn = (iso: string) => {
    if (!drag || !drag.legalDates.has(iso)) return;
    const scheduled = system.find((item) => item.exam.id === drag.examId);
    if (scheduled) onMoveExam(scheduled.exam, iso);
    setDrag(null);
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
          const holder = collabLocks[exam.id];
          const lockedByOther = Boolean(holder && holder.clientId !== myClientId);
          const inProgramFilter = highlighted.size === 0 || programList.some((number) => highlighted.has(number));
          const inSearch = matched.size === 0 || matched.has(exam.id);
          const dimmed = !inProgramFilter || !inSearch;
          const litUp = !dimmed && (highlighted.size > 0 || matched.size > 0);
          const time = timeAssignment.bookings.get(exam.id);
          return (
            <div
              key={exam.id}
              className={
                `exam-block ${!obligatory ? "elective" : ""}` +
                `${dimmed ? " chip-dim" : ""}${litUp ? " chip-lit" : ""}` +
                `${lockedByOther ? " chip-locked" : ""}`
              }
              draggable={isEditor && !lockedByOther}
              onDragStart={() => startDrag(scheduled)}
              onDragEnd={endDrag}
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
                  {lockedByOther && <div>{t("output.tooltipLockedBy", { name: holder!.name })}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="output-shell">
      <aside className="output-sidebar">
        <div className="output-sidebar-head">
          <span className="output-sidebar-icon">
            <Icon name="memory" />
          </span>
          <div>
            <div className="t-section" style={{ color: "var(--accent)", fontSize: 13 }}>
              {t("output.systemOf", {
                index: index + 1,
                total: report.totalSystems === null ? "?" : report.totalSystems.toLocaleString("en-US"),
              })}
            </div>
            <div className="t-micro muted">{t("output.examsScheduled", { count: system.length })}</div>
          </div>
        </div>
        <nav>
          {SIDEBAR_TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`sidebar-tab ${tab === entry.key ? "active" : ""}`}
              onClick={() => setTab(entry.key)}
            >
              <Icon name={entry.icon} />
              {t(entry.labelKey)}
            </button>
          ))}
        </nav>
        <div className="output-sidebar-foot" style={{ marginTop: "auto", padding: 16 }}>
          <button type="button" className="secondary" onClick={onBack} style={{ width: "100%" }}>
            <Icon name="arrow_back" />
            {t("output.backToInput")}
          </button>
        </div>
      </aside>

      <div className="output-main">
        <div className="system-nav">
          <button type="button" className="secondary" onClick={() => onIndexChange(index - 1)} disabled={index <= 0}>
            <Icon name="chevron_left" />
            {t("output.previousSystem")}
          </button>
          <div className="system-nav-title">
            <span className="t-headline-md">{t("output.examSystem", { index: index + 1 })}</span>
            <span className="muted">
              {t("output.outOfFound", { count: candidates.length.toLocaleString("en-US") })}
            </span>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => onIndexChange(index + 1)}
            disabled={index >= candidates.length - 1}
          >
            {t("output.nextSystem")}
            <Icon name="chevron_right" />
          </button>
          <div className="history-controls">
            <button
              type="button"
              className="secondary"
              onClick={onUndo}
              disabled={!canUndo}
              title={t("output.undoTitle")}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onRedo}
              disabled={!canRedo}
              title={t("output.redoTitle")}
            >
              <Icon name="redo" />
            </button>
          </div>
        </div>

        {tab === "overview" && (
          <>
            <div className="stat-strip">
              <div className="yield-block">
                <span className="t-label muted">{t("output.yieldLabel")}</span>
                <div className="yield-number">
                  {candidates.length}{" "}
                  <span className="of">
                    {t("output.bestOfPassing", { count: report.accepted.toLocaleString("en-US") })}
                  </span>
                </div>
                <span className="t-micro" style={{ color: "var(--accent)" }}>
                  {report.totalSystems === null
                    ? t("output.ofUnknownPossible")
                    : t("output.ofPossible", { count: report.totalSystems.toLocaleString("en-US") })}
                </span>
              </div>
              <div className="stat-cards">
                <div className="stat-card">
                  <div className="stat-card-head">
                    <span className="t-label">{t("output.avgGap")}</span>
                    <Icon name="schedule" />
                  </div>
                  <div className="stat-card-value">
                    {metrics.average_days_between_exams.toFixed(1)} <span className="unit">{t("output.days")}</span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-head">
                    <span className="t-label">{t("output.maxCollisions")}</span>
                    <Icon
                      name={
                        settings.maxElectiveCollisions !== null
                          ? metrics.worst_program_collisions <= settings.maxElectiveCollisions
                            ? "check_circle"
                            : "error"
                          : "info"
                      }
                      className={
                        settings.maxElectiveCollisions !== null
                          ? metrics.worst_program_collisions <= settings.maxElectiveCollisions
                            ? "ok"
                            : "warn"
                          : ""
                      }
                    />
                  </div>
                  <div className="stat-card-value">
                    {metrics.worst_program_collisions} <span className="unit">{t("output.events")}</span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-head">
                    <span className="t-label">{t("output.roomUtil")}</span>
                    <Icon name="info" />
                  </div>
                  <div className="stat-card-value">
                    {utilization === null ? "-" : Math.round(utilization)}
                    {utilization !== null && <span className="unit">%</span>}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-head">
                    <span className="t-label">{t("output.busiestDay")}</span>
                    <Icon
                      name={
                        settings.maxExamsPerDay
                          ? metrics.max_exams_per_day <= settings.maxExamsPerDay
                            ? "check_circle"
                            : "error"
                          : "info"
                      }
                      className={
                        settings.maxExamsPerDay
                          ? metrics.max_exams_per_day <= settings.maxExamsPerDay
                            ? "ok"
                            : "warn"
                          : ""
                      }
                    />
                  </div>
                  <div className="stat-card-value">
                    {metrics.max_exams_per_day} <span className="unit">{t("output.exams")}</span>
                  </div>
                </div>
              </div>
            </div>

            {!passesThresholds(metrics, settings) && (
              <div style={{ padding: "10px 20px 0" }}>
                <p className="error">{t("output.thresholdBroken")}</p>
              </div>
            )}
            {allocation && !allocation.isComplete && (
              <div style={{ padding: "10px 20px 0" }}>
                <p className="error">
                  {t("output.couldNotBeSeated", { count: allocation.failures.length, detail: allocation.failures[0] })}
                </p>
              </div>
            )}
            {collabNotice && (
              <div style={{ padding: "10px 20px 0" }}>
                <p className="notice">{collabNotice}</p>
              </div>
            )}
            {wasEdited && (
              <div style={{ padding: "10px 20px 0" }}>
                <p className="hint">
                  {t("output.editedByHand")}{" "}
                  <button type="button" className="link" onClick={onResetSystem}>
                    {t("output.resetLink")}
                  </button>
                </p>
              </div>
            )}

            <div className="program-legend">
              <div className="calendar-search">
                <Icon name="search" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("output.searchPlaceholder")}
                  aria-label={t("output.searchAriaLabel")}
                />
                {query && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setQuery("")}
                    aria-label={t("output.clearSearchAriaLabel")}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
              {selectedPrograms.length > 0 && (
                <>
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
                </>
              )}
            </div>
            {query && matched.size === 0 && (
              <div style={{ padding: "0 20px" }}>
                <p className="hint">{t("output.noMatch", { query })}</p>
              </div>
            )}

            <div className="calendar-canvas print-area">
              <WeekCalendar
                from={from}
                to={to}
                dayClassName={dayClassName}
                dayTitle={dayTitle}
                renderDay={renderDay}
                onDayDragOver={(iso, event) => {
                  if (drag?.legalDates.has(iso)) event.preventDefault();
                }}
                onDayDrop={(iso, event) => {
                  event.preventDefault();
                  dropOn(iso);
                }}
              />
            </div>
          </>
        )}

        {tab === "metrics" && <MetricsPanel metrics={metrics} settings={settings} />}
        {tab === "rooms" && <RoomsPanel system={system} allocation={allocation} hasRooms={rooms.length > 0} />}
        {tab === "compare" && (
          <ComparePanel
            candidates={candidates}
            index={index}
            compareAt={compareAt}
            onCompareAtChange={setCompareAt}
            roomAllocator={roomAllocator}
          />
        )}
        {tab === "benchmarks" && <BenchmarksPanel runs={benchmarks} onClear={onClearBenchmarks} />}
        {tab === "export" && (
          <div className="metrics-panel">
            <p className="hint">{t("output.exportDescription")}</p>
            <div className="loaders">
              {calendars.map((calendar) => (
                <div className="loader-card" key={calendar.fileName}>
                  <div className="loader-title">
                    <Icon name="calendar_month" />
                    <span className="t-data">
                      {calendar.programNumber} · {t("programs.yearLabel", { year: calendar.year })}
                    </span>
                  </div>
                  <p className="hint">{calendar.fileName}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => downloadText(calendar.fileName, calendar.text)}
                  >
                    <Icon name="file_download" />
                    {t("output.downloadIcs")}
                  </button>
                </div>
              ))}
            </div>

            <div className="panel-title" style={{ marginTop: 24 }}>
              <Icon name="mail" />
              <h2 className="t-section">{t("output.notifyTitle")}</h2>
            </div>
            {!wasEdited ? (
              <p className="hint">{t("output.notifyNoneMoved")}</p>
            ) : notifyDrafts.length === 0 ? (
              <p className="hint">{t("output.notifyNoPrograms")}</p>
            ) : (
              <>
                <p className="hint">{t("output.notifyExplain")}</p>
                <div className="loaders">
                  {notifyDrafts.map((draft) => (
                    <div className="loader-card" key={`${draft.programNumber}-${draft.year}`}>
                      <div className="loader-title">
                        <Icon name="campaign" />
                        <span className="t-data">
                          {draft.programNumber} · {t("programs.yearLabel", { year: draft.year })}
                        </span>
                      </div>
                      <p className="hint">{draft.subject}</p>
                      <a className="secondary button-like" href={draft.mailtoUrl}>
                        <Icon name="mail" />
                        {t("output.openDraft")}
                      </a>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="output-footer">
          <button
            type="button"
            className="primary"
            onClick={() =>
              downloadText(
                `exam-system-${index + 1}.txt`,
                formatSystem(system, index, report.totalSystems, selectedPrograms, programs, allocation, "")
              )
            }
          >
            <Icon name="save" />
            {t("output.saveSystem")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setTab("overview");
              window.setTimeout(() => window.print(), 50);
            }}
          >
            <Icon name="print" />
            {t("output.print")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={publishState === "publishing"}
            onClick={async () => {
              setPublishState("publishing");
              const ok = await onPublish(system);
              setPublishState(ok ? "done" : "error");
              window.setTimeout(() => setPublishState((current) => (current === "idle" ? current : "idle")), 4000);
            }}
          >
            <Icon name="campaign" />
            {t("output.publishForStudents")}
          </button>
          {publishState === "done" && <span className="hint success-text">{t("output.published")}</span>}
          {publishState === "error" && <span className="error">{t("output.publishFailed")}</span>}
          <span className="export-label">{t("output.generateExport")}</span>
          <div className="export-row">
            {calendars.slice(0, 3).map((calendar) => (
              <button
                type="button"
                className="secondary"
                key={calendar.fileName}
                onClick={() => downloadText(calendar.fileName, calendar.text)}
              >
                <Icon name="calendar_month" />
                {t("output.icsLabel", { program: calendar.programNumber, year: calendar.year })}
              </button>
            ))}
            {calendars.length > 3 && (
              <button type="button" className="secondary" onClick={() => setTab("export")}>
                <Icon name="more_horiz" />
                {t("output.more", { count: calendars.length - 3 })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComparePanel({
  candidates,
  index,
  compareAt,
  onCompareAtChange,
  roomAllocator,
}: {
  candidates: Candidate[];
  index: number;
  compareAt: number;
  onCompareAtChange: (at: number) => void;
  roomAllocator: RoomAllocator | null;
}) {
  const { t } = useTranslation();
  const a = candidates[index];
  const b = candidates[Math.min(compareAt, candidates.length - 1)];
  const rows: { labelKey: TranslationKey; key: keyof SystemMetrics; better: "lower" | "higher" }[] = [
    { labelKey: "output.rowMinGapObligatory", key: "min_days_between_obligatory", better: "higher" },
    { labelKey: "output.rowMinGapAny", key: "min_days_between_exams", better: "higher" },
    { labelKey: "output.rowAvgGap", key: "average_days_between_exams", better: "higher" },
    { labelKey: "output.rowElectiveCollisions", key: "elective_collisions", better: "lower" },
    { labelKey: "output.rowWorstCollisions", key: "worst_program_collisions", better: "lower" },
    { labelKey: "output.rowObligatorySpan", key: "obligatory_span", better: "higher" },
    { labelKey: "output.rowBusiestDay", key: "max_exams_per_day", better: "lower" },
  ];
  const utilA = roomAllocator ? roomUtilization(a.system, roomAllocator) : null;
  const utilB = roomAllocator ? roomUtilization(b.system, roomAllocator) : null;
  const NO_PAIR = 1_000_000;
  const cell = (value: number) => (value >= NO_PAIR ? "-" : value.toFixed(2).replace(/\.00$/, ""));

  return (
    <div className="metrics-panel">
      <p className="hint">{t("output.compareDescription", { index: index + 1 })}</p>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 320 }}>
        {t("output.compareAgainst")}
        <select value={compareAt} onChange={(event) => onCompareAtChange(Number(event.target.value))}>
          {candidates.map((_, at) => (
            <option key={at} value={at}>
              {t("output.systemOption", { number: at + 1 })}
              {at === index ? t("output.currentSuffix") : ""}
            </option>
          ))}
        </select>
      </label>

      <table className="rooms-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>{t("output.metricColumn")}</th>
            <th>{t("output.systemColumn", { number: index + 1 })}</th>
            <th>{t("output.systemColumn", { number: compareAt + 1 })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const valueA = a.metrics[row.key];
            const valueB = b.metrics[row.key];
            const aWins =
              valueA !== valueB &&
              valueA < NO_PAIR &&
              (row.better === "lower" ? valueA < valueB : valueA > valueB || valueB >= NO_PAIR);
            const bWins =
              valueA !== valueB &&
              valueB < NO_PAIR &&
              (row.better === "lower" ? valueB < valueA : valueB > valueA || valueA >= NO_PAIR);
            return (
              <tr key={row.key}>
                <td>{t(row.labelKey)}</td>
                <td className={aWins ? "ok" : ""}>{cell(valueA)}</td>
                <td className={bWins ? "ok" : ""}>{cell(valueB)}</td>
              </tr>
            );
          })}
          {roomAllocator && (
            <tr>
              <td>{t("output.rowRoomUtilisation")}</td>
              <td>{utilA === null ? "-" : `${Math.round(utilA)}%`}</td>
              <td>{utilB === null ? "-" : `${Math.round(utilB)}%`}</td>
            </tr>
          )}
          <tr>
            <td>{t("output.rowExamsScheduled")}</td>
            <td>{a.system.length}</td>
            <td>{b.system.length}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 10 }}>
        {t("output.compareLegend")}
      </p>
    </div>
  );
}

function BenchmarksPanel({ runs, onClear }: { runs: BenchmarkRun[]; onClear: () => void }) {
  const { t } = useTranslation();
  if (!runs.length) {
    return (
      <div className="metrics-panel">
        <p className="hint">{t("output.benchmarksEmpty")}</p>
      </div>
    );
  }
  const maxSeconds = Math.max(...runs.map((run) => run.seconds), 0.001);
  return (
    <div className="metrics-panel">
      <div className="panel-title">
        <Icon name="speed" />
        <h2 className="t-section" style={{ flex: 1 }}>
          {t("output.benchmarksTitle")}
        </h2>
        <button type="button" className="ghost" onClick={onClear}>
          <Icon name="delete" />
          {t("output.benchmarksClear")}
        </button>
      </div>
      <p className="hint">{t("output.benchmarksScopeNote")}</p>
      <div className="benchmark-chart">
        {runs.map((run) => (
          <div className="benchmark-bar-row" key={run.at}>
            <span className="benchmark-bar-label">{new Date(run.at).toLocaleString()}</span>
            <div className="benchmark-bar-track">
              <div
                className="benchmark-bar-fill"
                style={{ width: `${Math.max(2, (run.seconds / maxSeconds) * 100)}%` }}
              />
            </div>
            <span className="benchmark-bar-value">{run.seconds.toFixed(2)}s</span>
          </div>
        ))}
      </div>
      <table className="rooms-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>{t("output.colWhen")}</th>
            <th>{t("output.colExams")}</th>
            <th>{t("output.colExamined")}</th>
            <th>{t("output.colPassed")}</th>
            <th>{t("output.colKept")}</th>
            <th>{t("output.colBestGap")}</th>
            <th>{t("output.colSeconds")}</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((run) => (
            <tr key={run.at}>
              <td>{new Date(run.at).toLocaleString()}</td>
              <td>{run.exams}</td>
              <td>{run.examined.toLocaleString("en-US")}</td>
              <td>{run.accepted.toLocaleString("en-US")}</td>
              <td>{run.kept}</td>
              <td>{run.bestAverageGap === null ? "-" : run.bestAverageGap.toFixed(2)}</td>
              <td>{run.seconds.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricsPanel({ metrics, settings }: { metrics: SystemMetrics; settings: Settings }) {
  const { t } = useTranslation();
  const NO_PAIR = 1_000_000;
  const dash = (value: number) => (value >= NO_PAIR ? "-" : String(value));
  return (
    <div className="metrics-panel">
      <div className="metric-tiles">
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricMinObligatory")}</span>
          <div className="value">{dash(metrics.min_days_between_obligatory)} {t("output.days")}</div>
        </div>
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricMinAny")}</span>
          <div className="value">{dash(metrics.min_days_between_exams)} {t("output.days")}</div>
        </div>
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricAvgGap")}</span>
          <div className="value">{metrics.average_days_between_exams.toFixed(2)} {t("output.days")}</div>
        </div>
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricElectiveCollisionsTotal")}</span>
          <div className="value">{metrics.elective_collisions}</div>
        </div>
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricWorstCollisions")}</span>
          <div className="value">{metrics.worst_program_collisions}</div>
        </div>
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricObligatorySpan")}</span>
          <div className="value">{dash(metrics.obligatory_span)} {t("output.days")}</div>
        </div>
        <div className="metric-tile">
          <span className="t-label muted">{t("output.metricBusiestDay")}</span>
          <div className="value">{metrics.max_exams_per_day} {t("output.exams")}</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">
          <Icon name="tune" />
          <h2 className="t-section">{t("output.activeThresholds")}</h2>
        </div>
        {describeThresholds(settings).length === 0 ? (
          <p className="hint" style={{ marginTop: 10 }}>
            {t("output.noThresholds")}
          </p>
        ) : (
          <ul className="hint" style={{ marginTop: 10 }}>
            {describeThresholds(settings).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RoomsPanel({
  system,
  allocation,
  hasRooms,
}: {
  system: ExamSystem;
  allocation: RoomAllocation | null;
  hasRooms: boolean;
}) {
  const { t } = useTranslation();
  if (!hasRooms) {
    return (
      <div className="rooms-panel">
        <p className="hint">{t("output.roomsNotLoaded")}</p>
      </div>
    );
  }
  const sorted = [...system].sort(
    (a, b) => a.date.localeCompare(b.date) || a.exam.course.number.localeCompare(b.exam.course.number)
  );
  return (
    <div className="rooms-panel">
      {allocation && !allocation.isComplete && (
        <div className="panel">
          <div className="panel-title">
            <Icon name="warning" />
            <h2 className="t-section">{t("output.roomsCouldNotSeat")}</h2>
          </div>
          <ul className="hint" style={{ marginTop: 10 }}>
            {allocation.failures.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="panel">
        <div className="panel-title">
          <Icon name="meeting_room" />
          <h2 className="t-section">{t("output.roomsAllocationTitle")}</h2>
        </div>
        <table className="rooms-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>{t("output.colDate")}</th>
              <th>{t("output.colCourse")}</th>
              <th>{t("output.colRooms")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((scheduled) => {
              const booking = allocation?.bookings.get(scheduled.exam.id);
              return (
                <tr key={scheduled.exam.id}>
                  <td>{toDisplayDate(scheduled.date)}</td>
                  <td>
                    {scheduled.exam.course.number} {scheduled.exam.course.name}
                  </td>
                  <td>{booking ? booking.rooms.map((room) => room.name).join(", ") : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
