/**
 * Entering courses by hand, row by row, as an alternative to loading a
 * courses file or a courses CSV.
 *
 * A course can be taught in several study programs, years and semesters at
 * once (`enrollments`), so each row's "Programs" cell is itself a small
 * repeatable list - the one genuinely nested part of an otherwise flat table.
 */

import { useState } from "react";
import {
  Course,
  Evaluation,
  ProgramEnrollment,
  Requirement,
  SEMESTERS,
  Semester,
} from "../engine/model";
import { EVALUATION_KEY, REQUIREMENT_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";
import { Icon } from "./Icon";

interface Props {
  courses: Course[];
  onChange: (courses: Course[]) => void;
}

const EVALUATIONS: Evaluation[] = ["Exam", "Project", "Attendance"];
const REQUIREMENTS: Requirement[] = ["Obligatory", "Elective"];

function isValidCourseNumber(value: string): boolean {
  return /^\d{5}$/.test(value);
}

function isValidProgramNumber(value: string): boolean {
  return /^\d{5}$/.test(value);
}

/** One row's "Programs" cell: the enrollments already added, and a small form to add one more. */
function EnrollmentsEditor({
  enrollments,
  onChange,
}: {
  enrollments: ProgramEnrollment[];
  onChange: (enrollments: ProgramEnrollment[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ProgramEnrollment>({
    programNumber: "",
    year: 1,
    semester: "FALL",
    requirement: "Obligatory",
  });

  const addDraft = () => {
    if (!isValidProgramNumber(draft.programNumber)) return;
    onChange([...enrollments, draft]);
    setDraft({ ...draft, programNumber: "" });
  };

  const removeAt = (index: number) => onChange(enrollments.filter((_, at) => at !== index));

  return (
    <div className="enrollments-editor">
      <div className="enrollment-chips">
        {enrollments.map((enrollment, index) => (
          <span className="enrollment-chip" key={index}>
            {enrollment.programNumber} · {t("programs.yearLabel", { year: enrollment.year })} ·{" "}
            {t(SEMESTER_KEY[enrollment.semester])} · {t(REQUIREMENT_KEY[enrollment.requirement])}
            <button
              type="button"
              onClick={() => removeAt(index)}
              aria-label={t("manual.removeRow")}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
      </div>
      <div className="enrollment-form">
        <input
          type="text"
          className={`enrollment-program ${draft.programNumber && !isValidProgramNumber(draft.programNumber) ? "invalid" : ""}`}
          placeholder={t("manual.programNumberPlaceholder")}
          value={draft.programNumber}
          onChange={(event) => setDraft({ ...draft, programNumber: event.target.value })}
        />
        <select
          value={draft.year}
          onChange={(event) => setDraft({ ...draft, year: Number(event.target.value) })}
        >
          {[1, 2, 3, 4].map((year) => (
            <option key={year} value={year}>
              {t("programs.yearLabel", { year })}
            </option>
          ))}
        </select>
        <select
          value={draft.semester}
          onChange={(event) => setDraft({ ...draft, semester: event.target.value as Semester })}
        >
          {SEMESTERS.map((semester) => (
            <option key={semester} value={semester}>
              {t(SEMESTER_KEY[semester])}
            </option>
          ))}
        </select>
        <select
          value={draft.requirement}
          onChange={(event) => setDraft({ ...draft, requirement: event.target.value as Requirement })}
        >
          {REQUIREMENTS.map((requirement) => (
            <option key={requirement} value={requirement}>
              {t(REQUIREMENT_KEY[requirement])}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" onClick={addDraft} aria-label={t("manual.addEnrollment")}>
          <Icon name="add" />
        </button>
      </div>
    </div>
  );
}

export function CoursesTable({ courses, onChange }: Props) {
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<Course>) => {
    onChange(courses.map((course, at) => (at === index ? { ...course, ...patch } : course)));
  };

  const remove = (index: number) => onChange(courses.filter((_, at) => at !== index));

  const add = () => {
    onChange([
      ...courses,
      { number: "", name: "", instructor: "", enrollments: [], evaluation: "Exam" },
    ]);
  };

  return (
    <div className="data-table-wrap">
      {courses.length > 0 && (
        <table className="data-table courses-table">
          <thead>
            <tr>
              <th>{t("manual.courseNumber")}</th>
              <th>{t("manual.courseName")}</th>
              <th>{t("manual.courseInstructor")}</th>
              <th>{t("manual.coursePrograms")}</th>
              <th>{t("manual.courseEvaluation")}</th>
              <th>{t("manual.courseStudents")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {courses.map((course, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    className={isValidCourseNumber(course.number) ? "" : "invalid"}
                    value={course.number}
                    onChange={(event) => update(index, { number: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className={course.name.trim() ? "" : "invalid"}
                    value={course.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className={course.instructor.trim() ? "" : "invalid"}
                    value={course.instructor}
                    onChange={(event) => update(index, { instructor: event.target.value })}
                  />
                </td>
                <td>
                  <EnrollmentsEditor
                    enrollments={course.enrollments}
                    onChange={(enrollments) => update(index, { enrollments })}
                  />
                </td>
                <td>
                  <select
                    value={course.evaluation}
                    onChange={(event) => update(index, { evaluation: event.target.value as Evaluation })}
                  >
                    {EVALUATIONS.map((evaluation) => (
                      <option key={evaluation} value={evaluation}>
                        {t(EVALUATION_KEY[evaluation])}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    placeholder={t("manual.optional")}
                    value={course.students ?? ""}
                    onChange={(event) =>
                      update(index, {
                        students: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="ghost row-delete"
                    onClick={() => remove(index)}
                    aria-label={t("manual.removeRow")}
                  >
                    <Icon name="delete" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="secondary table-add-row" onClick={add}>
        <Icon name="add" />
        {t("manual.addCourse")}
      </button>
    </div>
  );
}
