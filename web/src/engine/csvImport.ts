/**
 * Reading courses and exam periods from a spreadsheet, saved as CSV.
 *
 * Excel, Google Sheets and every other spreadsheet program export to CSV in
 * one step (File > Download / Save As > CSV), so that is the one format this
 * reads rather than the binary `.xlsx`/`.xls` layouts - parsing those safely
 * would mean taking on a third-party library, and the one actively
 * maintained on the npm registry carries an unpatched vulnerability
 * (SheetJS's fixed builds are only published on their own site, not npm).
 * CSV is small enough to parse by hand, safely, with nothing to install.
 *
 * The two files use a long, one-row-per-fact layout, the way a spreadsheet
 * naturally holds this kind of data - a course taught in three programs is
 * three rows sharing its course number, not one row with three sets of
 * columns:
 *
 *   Courses:       CourseNumber, CourseName, Instructor, Program, Year,
 *                  Semester, Requirement, Evaluation, Students (optional)
 *   Exam periods:  Semester, Moed, StartDate, EndDate,
 *                  ExcludedStart, ExcludedEnd, Comment
 *
 * An exam period row either defines the period (StartDate and EndDate filled)
 * or adds one excluded date or range to a period defined elsewhere in the same
 * file (ExcludedStart filled, StartDate and EndDate left blank).
 */

import { parseEvaluation, parseMoed, parseRequirement, parseSemester } from "./parsers";
import { DataFileError } from "./parsers";
import { Course, ExamPeriod, ExcludedDates, ProgramEnrollment, fromDisplayDate } from "./model";
import { translate as t } from "../i18n/translate";

interface Row {
  number: number; // 1-based, header excluded
  cells: Record<string, string>;
}

/** A minimal RFC 4180 reader: quoted fields, embedded commas, doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    push();
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      push();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

function readRows(text: string): Row[] {
  const raw = parseCsv(text);
  if (!raw.length) throw new DataFileError(t("errors.csvNoRows"));
  const header = raw[0].map((name) => name.trim());
  return raw.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    header.forEach((name, column) => {
      record[name] = (cells[column] ?? "").trim();
    });
    return { number: index + 2, cells: record }; // +2: header is row 1
  });
}

function required(row: Row, column: string): string {
  const value = row.cells[column];
  if (!value) throw new DataFileError(t("errors.csvColumnEmpty", { column }), row.number);
  return value;
}

function requiredDate(row: Row, column: string): string {
  const text = required(row, column);
  const iso = fromDisplayDate(text);
  if (!iso) {
    throw new DataFileError(t("errors.csvDateInvalid", { value: text, column }), row.number);
  }
  return iso;
}

// --- courses ----------------------------------------------------------------

export function parseCoursesCsv(text: string): Course[] {
  const rows = readRows(text);
  const byNumber = new Map<string, Course>();

  for (const row of rows) {
    const number = required(row, "CourseNumber");
    if (!/^\d{5}$/.test(number)) {
      throw new DataFileError(t("errors.csvNot5Digits", { value: number, column: "CourseNumber" }), row.number);
    }
    const programNumber = required(row, "Program");
    if (!/^\d{5}$/.test(programNumber)) {
      throw new DataFileError(t("errors.csvNot5Digits", { value: programNumber, column: "Program" }), row.number);
    }
    const year = Number(required(row, "Year"));
    if (!Number.isInteger(year) || year < 1 || year > 4) {
      throw new DataFileError(t("errors.csvYearOutOfRange", { value: row.cells.Year }), row.number);
    }
    const enrollment: ProgramEnrollment = {
      programNumber,
      year,
      semester: parseSemester(required(row, "Semester"), row.number),
      requirement: parseRequirement(required(row, "Requirement"), row.number),
    };

    const existing = byNumber.get(number);
    if (existing) {
      existing.enrollments.push(enrollment);
      continue;
    }
    const studentsText = row.cells.Students;
    const students = studentsText ? Number(studentsText) : undefined;
    if (studentsText && (!Number.isInteger(students) || (students as number) < 1)) {
      throw new DataFileError(t("errors.csvStudentsNotPositive", { value: studentsText }), row.number);
    }
    byNumber.set(number, {
      number,
      name: required(row, "CourseName"),
      instructor: required(row, "Instructor"),
      enrollments: [enrollment],
      evaluation: parseEvaluation(required(row, "Evaluation"), row.number),
      students,
    });
  }

  if (!byNumber.size) throw new DataFileError(t("errors.csvNoCourseRows"));
  return [...byNumber.values()];
}

// --- exam periods -------------------------------------------------------------

export function parsePeriodsCsv(text: string): ExamPeriod[] {
  const rows = readRows(text);
  const byKey = new Map<string, ExamPeriod>();

  for (const row of rows) {
    const semester = parseSemester(required(row, "Semester"), row.number);
    const moed = parseMoed(required(row, "Moed"), row.number);
    const key = `${semester}|${moed}`;

    if (row.cells.StartDate || row.cells.EndDate) {
      const startDate = requiredDate(row, "StartDate");
      const endDate = requiredDate(row, "EndDate");
      if (startDate >= endDate) {
        throw new DataFileError(t("errors.csvStartNotBeforeEnd"), row.number);
      }
      const existing = byKey.get(key);
      byKey.set(key, { semester, moed, startDate, endDate, excluded: existing?.excluded ?? [] });
      continue;
    }

    if (row.cells.ExcludedStart) {
      const period = byKey.get(key);
      if (!period) {
        throw new DataFileError(
          t("errors.csvExcludedBeforePeriod", { semester, moed }),
          row.number
        );
      }
      const start = requiredDate(row, "ExcludedStart");
      const end = row.cells.ExcludedEnd ? requiredDate(row, "ExcludedEnd") : start;
      if (start > end) throw new DataFileError(t("errors.csvExcludedBackwards"), row.number);
      const rule: ExcludedDates = { start, end, comment: row.cells.Comment ?? "" };
      period.excluded.push(rule);
      continue;
    }

    throw new DataFileError(t("errors.csvRowNeedsDatesOrExcluded"), row.number);
  }

  if (!byKey.size) throw new DataFileError(t("errors.csvNoPeriodRows"));
  return [...byKey.values()];
}
