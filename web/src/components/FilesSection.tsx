/**
 * Requirement 2.1 - the user says which data files to work with.
 *
 * Every file can either replace what is stored (2.1.2) or be added to it
 * (2.1.3); both are one button press (2.1.1). Version 3.0 adds two files of its
 * own: the rooms of the campus and the dates the staff is not available on.
 */

import { ReactNode, useRef, useState } from "react";
import { Icon } from "./Icon";
import {
  mergeCourses,
  mergeEnrollment,
  mergeFaculty,
  mergeGlobalExcluded,
  mergePeriods,
  mergeRooms,
} from "../engine/edits";
import { Course, EnrollmentRoster, ExamPeriod, ExcludedDates, FacultyRules, Room } from "../engine/model";
import {
  DataFileError,
  parseCourses,
  parseExamPeriods,
  parseFacultyConstraints,
  parseGlobalExcluded,
  parseRooms,
} from "../engine/parsers";
import { parseCoursesCsv, parseEnrollmentCsv, parsePeriodsCsv } from "../engine/csvImport";
import { useTranslation, LanguageContextValue } from "../i18n/LanguageContext";
import { CoursesTable } from "./CoursesTable";
import { RoomsTable } from "./RoomsTable";
import { FacultyTable } from "./FacultyTable";

type Mode = "replace" | "add";

interface Props {
  courses: Course[];
  periods: ExamPeriod[];
  rooms: Room[];
  faculty: FacultyRules;
  globalExcluded: ExcludedDates[];
  enrollmentRoster: EnrollmentRoster;
  coursesFileName: string | null;
  periodsFileName: string | null;
  roomsFileName: string | null;
  facultyFileName: string | null;
  globalExcludedFileName: string | null;
  enrollmentRosterFileName: string | null;
  onCourses: (courses: Course[], fileName: string) => void;
  onPeriods: (periods: ExamPeriod[], fileName: string) => void;
  onRooms: (rooms: Room[], fileName: string) => void;
  onFaculty: (faculty: FacultyRules, fileName: string) => void;
  onGlobalExcluded: (globalExcluded: ExcludedDates[], fileName: string) => void;
  onEnrollmentRoster: (roster: EnrollmentRoster, fileName: string) => void;
  /** Live-table edits: the array changes directly, with no file behind it. */
  onCoursesChange: (courses: Course[]) => void;
  onRoomsChange: (rooms: Room[]) => void;
  onFacultyChange: (faculty: FacultyRules) => void;
}

interface LoaderProps<T> {
  title: string;
  summary: string;
  optional?: boolean;
  /** The primary file format read by the "Replace"/"Add" buttons - Appendix A `.txt` for most data types, but plain CSV for a type (like enrollment) that has no such text format of its own. */
  accept?: string;
  parse: (text: string) => T;
  parseCsv?: (text: string) => T;
  replace: (incoming: T, fileName: string) => void;
  add: (incoming: T, fileName: string) => void;
  /** The live table for this data type - shown when "Enter manually" is toggled on. Omitted where another panel on the same screen already edits this data live (exam periods). */
  manualEditor?: ReactNode;
}

function FileLoader<T>({
  title,
  summary,
  optional,
  accept = ".txt,text/plain",
  parse,
  parseCsv,
  replace,
  add,
  manualEditor,
}: LoaderProps<T>) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<Mode>("replace");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const pick = (mode: Mode, csv = false) => {
    modeRef.current = mode;
    setError(null);
    (csv ? csvInputRef : inputRef).current?.click();
  };

  const read = async (file: File, parser: (text: string) => T) => {
    try {
      const parsed = parser(await file.text());
      if (modeRef.current === "replace") replace(parsed, file.name);
      else add(parsed, file.name);
      setError(null);
    } catch (problem) {
      setError(
        problem instanceof DataFileError
          ? `${file.name}, ${problem.message}`
          : `${file.name}: ${(problem as Error).message}`
      );
    }
  };

  return (
    <div className="loader-card">
      <div className="loader-title">
        <span className="t-data" style={{ color: "var(--ink)" }}>
          {title}
        </span>
        {optional && <span className="badge">{t("files.optionalBadge")}</span>}
      </div>
      <p className="hint">{summary}</p>
      <div className="loader-buttons">
        <button type="button" className="secondary" onClick={() => pick("replace")}>
          <Icon name="upload_file" />
          {t("files.replaceButton")}
        </button>
        <button type="button" className="secondary" onClick={() => pick("add")}>
          <Icon name="add" />
          {t("files.addButton")}
        </button>
        {parseCsv && (
          <button type="button" className="secondary" onClick={() => pick("add", true)}>
            <Icon name="table_view" />
            {t("files.importCsvButton")}
          </button>
        )}
        {manualEditor && (
          <button
            type="button"
            className={manual ? "secondary active" : "secondary"}
            onClick={() => setManual(!manual)}
          >
            <Icon name="edit_note" />
            {manual ? t("files.hideManualButton") : t("files.enterManuallyButton")}
          </button>
        )}
        <input
          type="file"
          accept={accept}
          ref={inputRef}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file, parse);
          }}
        />
        {parseCsv && (
          <input
            type="file"
            accept=".csv,text/csv"
            ref={csvInputRef}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void read(file, parseCsv);
            }}
          />
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {manual && <div className="manual-editor">{manualEditor}</div>}
    </div>
  );
}

function loadedFrom(t: LanguageContextValue["t"], count: number, noun: string, fileName: string | null): string {
  if (!count) return t("files.summaryEmpty", { noun });
  return fileName
    ? t("files.summaryWithFile", { count, noun, fileName })
    : t("files.summaryNoFile", { count, noun });
}

export function FilesSection(props: Props) {
  const { t } = useTranslation();
  const seats = props.rooms.reduce((sum, room) => sum + room.capacity, 0);
  const instructors = Object.keys(props.faculty).length;

  return (
    <div className="panel">
      <div className="panel-title">
        <Icon name="folder_open" />
        <h2 className="t-section">{t("files.title")}</h2>
      </div>
      <p className="hint" style={{ margin: "10px 0 14px" }}>
        {t("files.descriptionIntro")} <code>$$$$</code>
        {t("files.descriptionCsvIntro")}{" "}
        <code>CourseNumber, CourseName, Instructor, Program, Year, Semester, Requirement,
        Evaluation, Students</code>{" "}
        {t("files.descriptionCsvMid")}{" "}
        <code>Semester, Moed, StartDate, EndDate, ExcludedStart, ExcludedEnd, Comment</code>{" "}
        {t("files.descriptionCsvEnd")}
      </p>
      <div className="loaders">
        <FileLoader<Course[]>
          title={t("files.coursesTitle")}
          summary={loadedFrom(t, props.courses.length, t("files.coursesNoun"), props.coursesFileName)}
          parse={parseCourses}
          parseCsv={parseCoursesCsv}
          replace={(incoming, fileName) => props.onCourses(incoming, fileName)}
          add={(incoming, fileName) =>
            props.onCourses(mergeCourses(props.courses, incoming), fileName)
          }
          manualEditor={<CoursesTable courses={props.courses} onChange={props.onCoursesChange} />}
        />
        <FileLoader<ExamPeriod[]>
          title={t("files.periodsTitle")}
          summary={loadedFrom(t, props.periods.length, t("files.periodsNoun"), props.periodsFileName)}
          parse={parseExamPeriods}
          parseCsv={parsePeriodsCsv}
          replace={(incoming, fileName) => props.onPeriods(incoming, fileName)}
          add={(incoming, fileName) =>
            props.onPeriods(mergePeriods(props.periods, incoming), fileName)
          }
        />
        <FileLoader<Room[]>
          title={t("files.roomsTitle")}
          optional
          summary={
            props.rooms.length
              ? props.roomsFileName
                ? t("files.roomsSummaryLoaded", { count: props.rooms.length, seats, fileName: props.roomsFileName })
                : t("files.roomsSummaryLoadedNoFile", { count: props.rooms.length, seats })
              : t("files.roomsSummaryEmpty")
          }
          parse={parseRooms}
          replace={(incoming, fileName) => props.onRooms(incoming, fileName)}
          add={(incoming, fileName) =>
            props.onRooms(mergeRooms(props.rooms, incoming), fileName)
          }
          manualEditor={<RoomsTable rooms={props.rooms} onChange={props.onRoomsChange} />}
        />
        <FileLoader<FacultyRules>
          title={t("files.facultyTitle")}
          optional
          summary={
            instructors
              ? props.facultyFileName
                ? t("files.facultySummaryLoaded", { count: instructors, fileName: props.facultyFileName })
                : t("files.facultySummaryLoadedNoFile", { count: instructors })
              : t("files.facultySummaryEmpty")
          }
          parse={parseFacultyConstraints}
          replace={(incoming, fileName) => props.onFaculty(incoming, fileName)}
          add={(incoming, fileName) =>
            props.onFaculty(mergeFaculty(props.faculty, incoming), fileName)
          }
          manualEditor={<FacultyTable faculty={props.faculty} onChange={props.onFacultyChange} />}
        />
        <FileLoader<ExcludedDates[]>
          title={t("files.globalExcludedTitle")}
          optional
          summary={
            props.globalExcluded.length
              ? props.globalExcludedFileName
                ? t("files.globalExcludedSummaryLoaded", { count: props.globalExcluded.length, fileName: props.globalExcludedFileName })
                : t("files.globalExcludedSummaryLoadedNoFile", { count: props.globalExcluded.length })
              : t("files.globalExcludedSummaryEmpty")
          }
          parse={parseGlobalExcluded}
          replace={(incoming, fileName) => props.onGlobalExcluded(incoming, fileName)}
          add={(incoming, fileName) =>
            props.onGlobalExcluded(mergeGlobalExcluded(props.globalExcluded, incoming), fileName)
          }
        />
        <FileLoader<EnrollmentRoster>
          title={t("files.enrollmentTitle")}
          optional
          accept=".csv,text/csv"
          summary={
            Object.keys(props.enrollmentRoster).length
              ? props.enrollmentRosterFileName
                ? t("files.enrollmentSummaryLoaded", {
                    count: Object.keys(props.enrollmentRoster).length,
                    fileName: props.enrollmentRosterFileName,
                  })
                : t("files.enrollmentSummaryLoadedNoFile", {
                    count: Object.keys(props.enrollmentRoster).length,
                  })
              : t("files.enrollmentSummaryEmpty")
          }
          parse={parseEnrollmentCsv}
          replace={(incoming, fileName) => props.onEnrollmentRoster(incoming, fileName)}
          add={(incoming, fileName) =>
            props.onEnrollmentRoster(mergeEnrollment(props.enrollmentRoster, incoming), fileName)
          }
        />
      </div>
    </div>
  );
}
