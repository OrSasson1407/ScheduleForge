/**
 * Requirements 2.2 and 2.3 - choosing the study programs, and looking into them.
 *
 * The programs are picked from the list on the screen, not from a file, and at
 * most five of them. Every selected program can be opened to show all of its
 * courses, split by year and semester (2.3.2).
 */

import { useState } from "react";
import { Icon } from "./Icon";
import { MAX_SELECTED_PROGRAMS, StudyProgram } from "../engine/catalog";
import { PROGRAM_PALETTE, ProgramColors } from "../engine/colors";
import { Course, Requirement, Semester } from "../engine/model";
import { EVALUATION_KEY, REQUIREMENT_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";

interface Props {
  programs: StudyProgram[];
  courses: Course[];
  selected: string[];
  programColors: ProgramColors;
  onChange: (selected: string[]) => void;
  onColorChange: (programNumber: string, color: string) => void;
}

/** A small coloured dot, with a palette that opens on click (tagging & theming). */
function ColorSwatch({ color, onPick }: { color: string; onPick: (color: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <span className="swatch-picker">
      <button
        type="button"
        className="swatch-button"
        style={{ background: color }}
        title={t("programs.colorSwatchTitle")}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      />
      {open && (
        <span className="swatch-palette" onClick={(event) => event.stopPropagation()}>
          {PROGRAM_PALETTE.map((option) => (
            <button
              key={option}
              type="button"
              className={`swatch-option ${option === color ? "current" : ""}`}
              style={{ background: option }}
              onClick={() => {
                onPick(option);
                setOpen(false);
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

const SEMESTER_SEQUENCE: Semester[] = ["FALL", "SPRI", "SUMM"];

interface CourseInProgram {
  course: Course;
  year: number;
  semester: Semester;
  requirement: Requirement;
}

function coursesOfProgram(courses: Course[], programNumber: string): CourseInProgram[] {
  const found: CourseInProgram[] = [];
  for (const course of courses) {
    for (const enrollment of course.enrollments) {
      if (enrollment.programNumber !== programNumber) continue;
      found.push({
        course,
        year: enrollment.year,
        semester: enrollment.semester,
        requirement: enrollment.requirement,
      });
    }
  }
  return found;
}

function ProgramDetails({ courses, programNumber }: { courses: Course[]; programNumber: string }) {
  const { t } = useTranslation();
  const inProgram = coursesOfProgram(courses, programNumber);
  if (!inProgram.length) {
    return <p className="hint">{t("programs.noCourses")}</p>;
  }
  const years = [...new Set(inProgram.map((entry) => entry.year))].sort();

  return (
    <div className="program-card-body">
      {years.map((year) => (
        <div className="year-block" key={year}>
          <h5>{t("programs.yearLabel", { year })}</h5>
          {SEMESTER_SEQUENCE.map((semester) => {
            const entries = inProgram
              .filter((entry) => entry.year === year && entry.semester === semester)
              .sort((a, b) => a.course.number.localeCompare(b.course.number));
            if (!entries.length) return null;
            return (
              <div className="semester-block" key={semester}>
                <h6 className="t-micro muted">{t(SEMESTER_KEY[semester])}</h6>
                <table className="courses">
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={`${entry.course.number}-${semester}`}>
                        <td className="course-number">{entry.course.number}</td>
                        <td>{entry.course.name}</td>
                        <td>
                          <span className={`tag ${entry.requirement.toLowerCase()}`}>
                            {t(REQUIREMENT_KEY[entry.requirement])}
                          </span>
                        </td>
                        <td>
                          <span className="tag evaluation">{t(EVALUATION_KEY[entry.course.evaluation])}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ProgramsSection({
  programs,
  courses,
  selected,
  programColors,
  onChange,
  onColorChange,
}: Props) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<string | null>(null);

  const toggle = (number: string) => {
    if (selected.includes(number)) {
      onChange(selected.filter((item) => item !== number));
      if (opened === number) setOpened(null);
      return;
    }
    if (selected.length >= MAX_SELECTED_PROGRAMS) return;
    onChange([...selected, number]);
  };

  return (
    <div className="panel">
      <div className="panel-title">
        <Icon name="school" />
        <h2 className="t-section">{t("programs.title")}</h2>
        <span className="t-micro muted">
          {t("programs.selectedOf", { count: selected.length, max: MAX_SELECTED_PROGRAMS })}
        </span>
      </div>

      <div className="program-grid" style={{ marginTop: 14 }}>
        {programs.map((program) => {
          const isSelected = selected.includes(program.number);
          const isFull = selected.length >= MAX_SELECTED_PROGRAMS && !isSelected;
          return (
            <label
              key={program.number}
              className={`program-row ${isSelected ? "selected" : ""} ${isFull ? "disabled" : ""}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isFull}
                onChange={() => toggle(program.number)}
              />
              {isSelected && (
                <span className="dot" style={{ background: programColors[program.number] }} />
              )}
              <span className="t-data">{program.number}</span>
              <span className="program-name">{program.name}</span>
            </label>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="col" style={{ gap: 8, marginTop: 16 }}>
          {selected.map((number) => {
            const program = programs.find((item) => item.number === number);
            const isOpen = opened === number;
            return (
              <div className="program-card" key={number}>
                <div
                  className="program-card-head"
                  onClick={() => setOpened(isOpen ? null : number)}
                  role="button"
                  aria-expanded={isOpen}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ColorSwatch
                      color={programColors[number] ?? PROGRAM_PALETTE[0]}
                      onPick={(color) => onColorChange(number, color)}
                    />
                    <span className="t-data">
                      {number} - {program?.name ?? ""}
                    </span>
                  </div>
                  <Icon name={isOpen ? "expand_less" : "expand_more"} />
                </div>
                {isOpen && <ProgramDetails courses={courses} programNumber={number} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
