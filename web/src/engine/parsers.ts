/**
 * Parsers of the two data files of requirement 2.1, in the format of Appendix A:
 * UTF-8 text, records separated by a line holding four "$" signs.
 */

import {
  Course,
  Evaluation,
  ExamPeriod,
  ExcludedDates,
  FacultyRules,
  Moed,
  ProgramEnrollment,
  Requirement,
  Room,
  Semester,
  fromDisplayDate,
} from "./model";
import { translate as t } from "../i18n/translate";

export class DataFileError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(line === undefined ? message : t("errors.linePrefix", { line, message }));
    this.name = "DataFileError";
  }
}

const RECORD_SEPARATOR = "$$$$";

interface Line {
  number: number;
  text: string;
}

function readRecords(text: string): Line[][] {
  const records: Line[][] = [];
  let current: Line[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed === RECORD_SEPARATOR) {
      if (current.length) records.push(current);
      current = [];
      return;
    }
    current.push({ number: index + 1, text: trimmed });
  });
  if (current.length) records.push(current);
  return records;
}

const SEMESTER_ALIASES: Record<string, Semester> = {
  FALL: "FALL",
  SPRI: "SPRI",
  SPRING: "SPRI",
  SUMM: "SUMM",
  SUMMER: "SUMM",
};

const MOED_ALIASES: Record<string, Moed> = {
  ALEPH: "ALEPH",
  A: "ALEPH",
  BET: "BET",
  B: "BET",
  GIMEL: "GIMEL",
  C: "GIMEL",
};

export function parseSemester(text: string, line: number): Semester {
  const value = SEMESTER_ALIASES[text.trim().toUpperCase()];
  if (!value) {
    throw new DataFileError(t("errors.notLegalSemester", { value: text.trim() }), line);
  }
  return value;
}

export function parseMoed(text: string, line: number): Moed {
  const value = MOED_ALIASES[text.trim().toUpperCase()];
  if (!value) {
    throw new DataFileError(t("errors.notLegalMoed", { value: text.trim() }), line);
  }
  return value;
}

export function parseRequirement(text: string, line: number): Requirement {
  const value = text.trim().toUpperCase();
  if (value === "OBLIGATORY") return "Obligatory";
  if (value === "ELECTIVE") return "Elective";
  throw new DataFileError(t("errors.notLegalRequirement", { value: text.trim() }), line);
}

export function parseEvaluation(text: string, line: number): Evaluation {
  const value = text.trim().toUpperCase();
  if (value === "EXAM") return "Exam";
  if (value === "PROJECT") return "Project";
  if (value === "ATTENDANCE") return "Attendance";
  throw new DataFileError(t("errors.notLegalEvaluation", { value: text.trim() }), line);
}

// --- the courses file -----------------------------------------------------

export function parseCourses(text: string): Course[] {
  const records = readRecords(text);
  if (!records.length) throw new DataFileError(t("errors.coursesFileEmpty"));

  const courses: Course[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const course = parseCourseRecord(record);
    if (seen.has(course.number)) {
      throw new DataFileError(t("errors.courseAppearsTwice", { number: course.number }), record[1].number);
    }
    seen.add(course.number);
    courses.push(course);
  }
  return courses;
}

function parseCourseRecord(record: Line[]): Course {
  if (record.length < 5) {
    throw new DataFileError(
      t("errors.courseRecordTooShort", { count: record.length }),
      record[0].number
    );
  }

  // Version 3.0 adds an optional last line: how many students the exam seats.
  let students: number | undefined;
  const lastLine = record[record.length - 1];
  if (/^\d+$/.test(lastLine.text)) {
    students = Number(lastLine.text);
    if (students < 1) {
      throw new DataFileError(t("errors.studentsNotPositive"), lastLine.number);
    }
    record = record.slice(0, -1);
    if (record.length < 5) {
      throw new DataFileError(t("errors.courseRecordTooShortBeforeStudents"), record[0].number);
    }
  }

  const numberLine = record[1];
  if (!/^\d{5}$/.test(numberLine.text)) {
    throw new DataFileError(
      t("errors.courseNumberNot5Digits", { value: numberLine.text }),
      numberLine.number
    );
  }
  const enrollments = record.slice(3, -1).map(parseEnrollment);
  return {
    name: record[0].text,
    number: numberLine.text,
    instructor: record[2].text,
    enrollments,
    evaluation: parseEvaluation(record[record.length - 1].text, record[record.length - 1].number),
    students,
  };
}

// --- the rooms file (version 3.0) -----------------------------------------

export function parseRooms(text: string): Room[] {
  const records = readRecords(text);
  if (!records.length) throw new DataFileError(t("errors.roomsFileEmpty"));

  const rooms: Room[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (record.length < 2) {
      throw new DataFileError(
        t("errors.roomRecordTooShort", { count: record.length }),
        record[0].number
      );
    }
    const capacityLine = record[1];
    if (!/^\d+$/.test(capacityLine.text)) {
      throw new DataFileError(
        t("errors.capacityNotNumber", { value: capacityLine.text }),
        capacityLine.number
      );
    }
    const capacity = Number(capacityLine.text);
    if (capacity < 1) {
      throw new DataFileError(
        t("errors.capacityNotPositive", { value: capacity }),
        capacityLine.number
      );
    }
    const name = record[0].text;
    if (seen.has(name)) {
      throw new DataFileError(t("errors.roomAppearsTwice", { name }), record[0].number);
    }
    seen.add(name);
    rooms.push({ name, capacity, location: record.length > 2 ? record[2].text : "" });
  }
  return rooms;
}

// --- the staff constraints file (version 3.0) ------------------------------

export function parseFacultyConstraints(text: string): FacultyRules {
  const records = readRecords(text);
  if (!records.length) {
    throw new DataFileError(t("errors.facultyFileEmpty"));
  }
  const rules: FacultyRules = {};
  for (const record of records) {
    if (record.length < 2) {
      throw new DataFileError(
        t("errors.facultyRecordTooShort", { count: record.length }),
        record[0].number
      );
    }
    const instructor = record[0].text;
    const dates = record.slice(1).map(parseExcluded);
    rules[instructor] = (rules[instructor] ?? []).concat(dates);
  }
  return rules;
}

// --- the global excluded dates file (optional) -----------------------------

/**
 * Dates on which no exam of any course may take place, for the whole
 * institution - unlike the staff constraints file, no header line names
 * anything, since every line of every record is a date line.
 */
export function parseGlobalExcluded(text: string): ExcludedDates[] {
  const records = readRecords(text);
  if (!records.length) throw new DataFileError(t("errors.globalExcludedFileEmpty"));
  return records.flatMap((record) => record.map(parseExcluded));
}

function parseEnrollment(line: Line): ProgramEnrollment {
  const fields = line.text.split(",").map((field) => field.trim());
  if (fields.length !== 4) {
    throw new DataFileError(
      t("errors.enrollmentFieldCount", { count: fields.length, value: line.text }),
      line.number
    );
  }
  const [programNumber, yearText, semesterText, requirementText] = fields;
  if (!/^\d{5}$/.test(programNumber)) {
    throw new DataFileError(t("errors.programNumberNot5Digits", { value: programNumber }), line.number);
  }
  const year = Number(yearText);
  if (!Number.isInteger(year) || year < 1 || year > 4) {
    throw new DataFileError(t("errors.yearOutOfRange", { value: yearText }), line.number);
  }
  return {
    programNumber,
    year,
    semester: parseSemester(semesterText, line.number),
    requirement: parseRequirement(requirementText, line.number),
  };
}

// --- the exam periods file ------------------------------------------------

export function parseExamPeriods(text: string): ExamPeriod[] {
  const records = readRecords(text);
  if (!records.length) throw new DataFileError(t("errors.periodsFileEmpty"));

  const periods: ExamPeriod[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const period = parsePeriodRecord(record);
    const key = `${period.semester}|${period.moed}`;
    if (seen.has(key)) {
      throw new DataFileError(
        t("errors.periodDefinedTwice", { semester: period.semester, moed: period.moed }),
        record[0].number
      );
    }
    seen.add(key);
    periods.push(period);
  }
  return periods;
}

function parsePeriodRecord(record: Line[]): ExamPeriod {
  if (record.length < 2) {
    throw new DataFileError(
      t("errors.periodRecordTooShort", { count: record.length }),
      record[0].number
    );
  }
  const header = record[0].text.split(",").map((field) => field.trim());
  if (header.length !== 2) {
    throw new DataFileError(
      t("errors.periodHeaderInvalid", { value: record[0].text }),
      record[0].number
    );
  }
  const semester = parseSemester(header[0], record[0].number);
  const moed = parseMoed(header[1], record[0].number);

  const dates = record[1].text.split(",").map((field) => field.trim());
  if (dates.length !== 2) {
    throw new DataFileError(
      t("errors.periodDatesLineInvalid", { value: record[1].text }),
      record[1].number
    );
  }
  const startDate = requireDate(dates[0], record[1].number);
  const endDate = requireDate(dates[1], record[1].number);
  if (startDate >= endDate) {
    throw new DataFileError(
      t("errors.startNotBeforeEnd", { start: dates[0], end: dates[1] }),
      record[1].number
    );
  }

  const excluded = record.slice(2).map(parseExcluded);
  return { semester, moed, startDate, endDate, excluded };
}

function parseExcluded(line: Line): ExcludedDates {
  const fields = line.text.split(",").map((field) => field.trim());
  if (fields.length === 1) {
    const [date, comment] = splitDateAndComment(fields[0], line.number);
    return { start: date, end: date, comment };
  }
  if (fields.length === 2) {
    const [start] = splitDateAndComment(fields[0], line.number);
    const [end, comment] = splitDateAndComment(fields[1], line.number);
    if (start > end) {
      throw new DataFileError(t("errors.excludedRangeBackwards", { value: line.text }), line.number);
    }
    return { start, end, comment };
  }
  throw new DataFileError(t("errors.excludedLineInvalid", { value: line.text }), line.number);
}

function splitDateAndComment(text: string, line: number): [string, string] {
  const match = /^\d{2}-\d{2}-\d{4}/.exec(text);
  if (!match) {
    throw new DataFileError(t("errors.dateMissingPrefix", { value: text }), line);
  }
  return [requireDate(match[0], line), text.slice(match[0].length).trim()];
}

function requireDate(text: string, line: number): string {
  const iso = fromDisplayDate(text);
  if (!iso) {
    throw new DataFileError(t("errors.dateInvalid", { value: text }), line);
  }
  return iso;
}
