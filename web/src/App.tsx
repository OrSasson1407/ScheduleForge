/**
 * ScheduleForge 3.0 - the screens and what joins them.
 *
 * Three top-level screens - Input, Settings, Output - matching the way the
 * requirements themselves group the work: everything requirement 2 asks the
 * user to provide, in one place; what requirement sections 2 and 3 of version
 * 3.0 let the user tune, in a second; what the search produces, in a third.
 * The input screen lays its three parts - data files, study programs, exam
 * periods - out as a dense two column grid of cards rather than one long
 * column, so nothing has to be found by scrolling.
 *
 * The screens hold no scheduling code of their own: they read the data files
 * with the parsers of the engine, hand the engine the study programs and the
 * settings the user chose, and show the exam systems the engine found.
 *
 * `workingSystem` is the one exam system the output screen shows: it starts as
 * the search result at `outputIndex`, and from then on every drag on the
 * calendar and every move that arrives from the collaboration room edits it in
 * place. It lives here, in App, rather than inside the output screen, because
 * a move from someone else in the room has to be kept even while this browser
 * is looking at a different screen.
 */

import { useEffect, useMemo, useState } from "react";
import { CollabBar } from "./components/CollabBar";
import { FilesSection } from "./components/FilesSection";
import { Icon } from "./components/Icon";
import { LanguageToggle } from "./components/LanguageToggle";
import { Logo } from "./components/Logo";
import { PeriodsSection } from "./components/PeriodsSection";
import { ProgramsSection } from "./components/ProgramsSection";
import { OutputScreen } from "./screens/OutputScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { useAuth } from "./auth/AuthContext";
import { publish as apiPublish } from "./auth/api";
import { useCollab } from "./collab/useCollab";
import { useTranslation } from "./i18n/LanguageContext";
import { TranslationKey } from "./i18n/types";
import { programsOf } from "./engine/catalog";
import { assignProgramColors } from "./engine/colors";
import { BenchmarkRun, clearBenchmarks, loadBenchmarks, recordBenchmark } from "./engine/benchmarks";
import { decompose } from "./engine/decomposition";
import { withExamById, withExamOn } from "./engine/edit";
import { SchedulingDataError, buildExams } from "./engine/exams";
import { dataProblems } from "./engine/completeness";
import { Candidate, SearchReport, runSearch, sortCandidates } from "./engine/generator";
import { Exam, ExamSystem } from "./engine/model";
import { Settings } from "./engine/settings";
import { EMPTY_DATA, PublishedSchedule, StoredData, Theme, loadStored, saveStored } from "./state/storage";

type Screen = "input" | "settings" | "output";

const TABS: { name: Screen; labelKey: TranslationKey }[] = [
  { name: "input", labelKey: "nav.input" },
  { name: "settings", labelKey: "nav.settings" },
  { name: "output", labelKey: "nav.output" },
];

interface Found {
  candidates: Candidate[];
  report: SearchReport;
}

export default function App() {
  const { t } = useTranslation();
  const { account, token, logout } = useAuth();
  const restored = useMemo(loadStored, []);
  const [data, setData] = useState<StoredData>(restored ?? EMPTY_DATA);
  const [screen, setScreen] = useState<Screen>("input");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputIndex, setOutputIndex] = useState(0);
  //: The edits made to the system currently on screen, as a stack: `history`
  //: holds every state reached, oldest first, and `historyAt` is where in it
  //: we currently are. Undo and redo just move `historyAt`; a new edit cuts
  //: off whatever redo states were ahead of it, the way an editor's undo
  //: stack always does.
  const [history, setHistory] = useState<ExamSystem[]>([]);
  const [historyAt, setHistoryAt] = useState(0);
  const workingSystem = history[historyAt] ?? null;
  const [collabNotice, setCollabNotice] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkRun[]>(loadBenchmarks);

  useEffect(() => {
    saveStored(data);
  }, [data]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", data.theme);
  }, [data.theme]);

  /** Every selected program gets a colour the first time it is picked. */
  useEffect(() => {
    const next = assignProgramColors(data.selectedPrograms, data.programColors);
    const changed = data.selectedPrograms.some((number) => next[number] !== data.programColors[number]);
    if (changed) setData((current) => ({ ...current, programColors: next }));
  }, [data.selectedPrograms, data.programColors]);

  /** Editing starts over from the search result whenever a different one is shown. */
  useEffect(() => {
    const start = found?.candidates[outputIndex]?.system;
    setHistory(start ? [start] : []);
    setHistoryAt(0);
  }, [found, outputIndex]);

  /** Apply a new edit, discarding whatever redo states were ahead of it. */
  const pushEdit = (next: ExamSystem) => {
    setHistory((current) => [...current.slice(0, historyAt + 1), next]);
    setHistoryAt((at) => at + 1);
  };

  const notify = (text: string) => {
    setCollabNotice(text);
    window.setTimeout(() => setCollabNotice((current) => (current === text ? null : current)), 4000);
  };

  const collab = useCollab({
    onState: (examDates, remoteSettings) => {
      if (workingSystem) {
        let next = workingSystem;
        for (const [examId, date] of Object.entries(examDates)) next = withExamById(next, examId, date);
        if (next !== workingSystem) pushEdit(next);
      }
      if (remoteSettings) setData((current) => ({ ...current, settings: remoteSettings }));
    },
    onMoved: (examId, date) => {
      if (workingSystem) pushEdit(withExamById(workingSystem, examId, date));
    },
    onSettings: (remoteSettings, by) => {
      setData((current) => ({ ...current, settings: remoteSettings }));
      notify(t("collab.settingsChangedNotice", { by }));
    },
    onDenied: (examId, heldBy) => {
      const course = workingSystem?.find((scheduled) => scheduled.exam.id === examId)?.exam.course;
      notify(
        t("collab.examDeniedNotice", {
          exam: course ? `${course.number} ${course.name}` : t("collab.thatExam"),
          heldBy,
        })
      );
    },
  });

  const programs = useMemo(() => programsOf(data.courses), [data.courses]);
  const problems = useMemo(
    () => dataProblems(data.courses, data.periods, data.rooms, data.faculty, data.settings.defaultStudents),
    [data.courses, data.periods, data.rooms, data.faculty, data.settings.defaultStudents]
  );
  const ready =
    data.courses.length > 0 &&
    data.periods.length > 0 &&
    data.selectedPrograms.length > 0 &&
    problems.length === 0;

  /** Any change of the data makes the systems that were found out of date. */
  const update = (patch: Partial<StoredData>) => {
    setFound(null);
    setError(null);
    setData((current) => ({ ...current, ...patch }));
  };

  /**
   * The sorting may change without searching again (section 3): only the order
   * of the list changes, so the systems that were found are kept.
   */
  const changeSettings = (settings: Settings) => {
    if (collab.isConnected && !collab.isViewer) collab.sendSettings(settings);
    const onlySorting =
      found !== null &&
      JSON.stringify({ ...settings, sortCriteria: [] }) ===
        JSON.stringify({ ...data.settings, sortCriteria: [] });
    if (onlySorting) {
      setFound({
        candidates: sortCandidates([...found.candidates], settings.sortCriteria),
        report: found.report,
      });
      setData((current) => ({ ...current, settings }));
      return;
    }
    update({ settings });
  };

  const run = () => {
    try {
      const exams = buildExams(data.courses, data.periods, data.selectedPrograms);
      if (!exams.length) {
        throw new SchedulingDataError(t("errors.noExamsToSchedule"));
      }
      if (data.settings.requireRooms && !data.rooms.length) {
        throw new SchedulingDataError(t("errors.roomsRequiredNotLoaded"));
      }
      const decomposition = decompose(
        exams,
        data.periods,
        data.settings,
        data.faculty,
        data.settings.sortCriteria.length > 0
      );
      const blocked = exams.filter((_, index) => !decomposition.datesOfExam[index].length);
      if (blocked.length) {
        throw new SchedulingDataError(
          t("errors.noDateLeftForExams", {
            exams: blocked.map((exam) => `${exam.course.number} ${exam.course.name}`).join(", "),
          })
        );
      }
      const result = runSearch({
        exams,
        decomposition,
        settings: data.settings,
        rooms: data.rooms,
        faculty: data.faculty,
      });
      setFound(result);
      setOutputIndex(0);
      setError(null);
      setScreen("output");
      setBenchmarks(
        recordBenchmark({
          at: new Date().toISOString(),
          exams: exams.length,
          totalSystems: result.report.totalSystems === null ? null : result.report.totalSystems.toString(),
          examined: result.report.examined,
          accepted: result.report.accepted,
          kept: result.candidates.length,
          seconds: result.report.seconds,
          bestAverageGap: result.candidates[0]?.metrics.average_days_between_exams ?? null,
        })
      );
    } catch (problem) {
      setFound(null);
      setError((problem as Error).message);
    }
  };

  const onMoveExam = (exam: Exam, date: string) => {
    if (collab.isViewer) return; // a viewer's own drag is already blocked before this fires; refuse it here too
    if (workingSystem) pushEdit(withExamOn(workingSystem, exam, date));
    if (collab.isConnected) collab.move(exam.id, date);
  };

  const onResetSystem = () => {
    const start = found?.candidates[outputIndex]?.system;
    setHistory(start ? [start] : []);
    setHistoryAt(0);
  };

  const onUndo = () => setHistoryAt((at) => Math.max(0, at - 1));
  const onRedo = () => setHistoryAt((at) => Math.min(history.length - 1, at + 1));

  const onPublish = async (system: ExamSystem): Promise<boolean> => {
    if (!token) return false;
    const schedule: PublishedSchedule = {
      system,
      periods: data.periods,
      rooms: data.rooms,
      selectedPrograms: data.selectedPrograms,
      programColors: data.programColors,
      programs,
      settings: data.settings,
      publishedAt: new Date().toISOString(),
    };
    return apiPublish(token, schedule);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Logo />
          <span className="t-headline-md">
            ScheduleForge <span className="muted" style={{ fontWeight: 400 }}>v3.0</span>
          </span>
        </div>
        <nav className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.name}
              type="button"
              className={screen === entry.name ? "tab active" : "tab"}
              disabled={entry.name === "output" && found === null}
              onClick={() => setScreen(entry.name)}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </nav>
        <div className="header-spacer" />
        <CollabBar
          status={collab.status}
          users={collab.users}
          myClientId={collab.myClientId}
          onConnect={(url, room, name, role) => collab.connect(url, room, name, role)}
          onDisconnect={collab.disconnect}
        />
        <span className="t-data muted">{account?.displayName}</span>
        <LanguageToggle />
        <button
          type="button"
          className="icon-button"
          title={data.theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
          onClick={() =>
            // Day or night changes nothing about the schedule, so the exam
            // systems that were found stay where they are.
            setData((current) => ({
              ...current,
              theme: (current.theme === "dark" ? "light" : "dark") as Theme,
            }))
          }
        >
          <Icon name={data.theme === "dark" ? "light_mode" : "dark_mode"} />
        </button>
        <button type="button" className="icon-button" title={t("auth.signOut")} onClick={logout}>
          <Icon name="logout" />
        </button>
      </header>

      {screen === "input" && (
        <div className="screen" style={{ paddingBottom: 88 }}>
          {restored && (restored.courses.length > 0 || restored.periods.length > 0) && (
            <p className="notice">
              {t("input.storageNotice", { time: new Date(restored.savedAt ?? "").toLocaleString() })}
            </p>
          )}
          <div className="grid-2">
            <div className="col">
              <FilesSection
                courses={data.courses}
                periods={data.periods}
                rooms={data.rooms}
                faculty={data.faculty}
                coursesFileName={data.coursesFileName}
                periodsFileName={data.periodsFileName}
                roomsFileName={data.roomsFileName}
                facultyFileName={data.facultyFileName}
                onCourses={(courses, fileName) => update({ courses, coursesFileName: fileName })}
                onPeriods={(periods, fileName) => update({ periods, periodsFileName: fileName })}
                onRooms={(rooms, fileName) => update({ rooms, roomsFileName: fileName })}
                onFaculty={(faculty, fileName) => update({ faculty, facultyFileName: fileName })}
                onCoursesChange={(courses) => update({ courses, coursesFileName: null })}
                onRoomsChange={(rooms) => update({ rooms, roomsFileName: null })}
                onFacultyChange={(faculty) => update({ faculty, facultyFileName: null })}
              />
              <ProgramsSection
                programs={programs}
                courses={data.courses}
                selected={data.selectedPrograms}
                programColors={data.programColors}
                onChange={(selectedPrograms) => update({ selectedPrograms })}
                onColorChange={(programNumber, color) =>
                  setData((current) => ({
                    ...current,
                    programColors: { ...current.programColors, [programNumber]: color },
                  }))
                }
              />
            </div>
            <PeriodsSection periods={data.periods} onChange={(periods) => update({ periods })} />
          </div>

          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 30,
              background: "var(--surface)",
              borderTop: "1px solid var(--line)",
              padding: 16,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 16,
            }}
          >
            {error && <p className="error">{error}</p>}
            {problems.length > 0 && (
              <div className="problem-list">
                <p className="error" style={{ margin: 0 }}>
                  {t("input.fixBeforeRunning")}
                </p>
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            {!ready && problems.length === 0 && (
              <p className="hint" style={{ margin: 0 }}>
                {t("input.stillNeeded", {
                  items: [
                    data.courses.length ? null : t("input.needCourses"),
                    data.periods.length ? null : t("input.needPeriods"),
                    data.selectedPrograms.length ? null : t("input.needPrograms"),
                  ]
                    .filter(Boolean)
                    .join(", "),
                })}
              </p>
            )}
            <button type="button" className="primary" disabled={!ready} onClick={run}>
              <Icon name="precision_manufacturing" />
              {t("input.produceButton")}
            </button>
          </div>
        </div>
      )}

      {screen === "settings" && (
        <SettingsScreen
          settings={data.settings}
          hasRooms={data.rooms.length > 0}
          onChange={changeSettings}
          onRun={run}
          canRun={ready}
          readOnly={collab.isViewer}
        />
      )}

      {screen === "output" &&
        (found ? (
          <OutputScreen
            candidates={found.candidates}
            report={found.report}
            periods={data.periods}
            rooms={data.rooms}
            faculty={data.faculty}
            programs={programs}
            selectedPrograms={data.selectedPrograms}
            programColors={data.programColors}
            settings={data.settings}
            index={outputIndex}
            onIndexChange={setOutputIndex}
            workingSystem={workingSystem}
            onMoveExam={onMoveExam}
            onResetSystem={onResetSystem}
            canUndo={historyAt > 0}
            canRedo={historyAt < history.length - 1}
            onUndo={onUndo}
            onRedo={onRedo}
            collabConnected={collab.isConnected}
            collabLocks={collab.locks}
            myClientId={collab.myClientId}
            collabNotice={collabNotice}
            isEditor={!collab.isViewer}
            onRequestLock={collab.requestLock}
            onReleaseLock={collab.releaseLock}
            benchmarks={benchmarks}
            onClearBenchmarks={() => {
              clearBenchmarks();
              setBenchmarks([]);
            }}
            onPublish={onPublish}
            onBack={() => setScreen("input")}
          />
        ) : (
          <div className="screen">
            <div className="panel">
              <p className="hint">{t("output.produceFirst")}</p>
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        ))}
    </div>
  );
}
