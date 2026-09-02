/**
 * The calendar a teacher's or a student's screen draws from a published
 * schedule - the same week-by-week rendering `OutputScreen` uses for an
 * editor, minus every edit ability, and narrowed by `filterExam` to only the
 * exams that account is meant to see (an instructor's own exams, or one
 * study program and year). Pulled out once both `StudentView` and
 * `TeacherScreen` needed it, rather than keeping two copies of the same
 * rendering in sync by hand.
 */

import { useMemo, useState } from "react";
import { WeekCalendar } from "./WeekCalendar";
import { MOED_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";
import { ExamPeriod, ScheduledExam, isExcluded, toDisplayDate } from "../engine/model";
import { PublishedSchedule } from "../state/storage";
import { RoomAllocation, RoomAllocator } from "../engine/rooms";
import { assignTimes } from "../engine/timeAssignment";

function shorten(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

interface Props {
  published: PublishedSchedule;
  filterExam: (scheduled: ScheduledExam) => boolean;
}

export function PublishedScheduleCalendar({ published, filterExam }: Props) {
  const { t } = useTranslation();
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const roomAllocator = useMemo(
    () => (published.rooms.length ? new RoomAllocator(published.rooms, published.settings.defaultStudents) : null),
    [published]
  );
  const allocation: RoomAllocation | null = useMemo(
    () => (roomAllocator ? roomAllocator.allocate(published.system) : null),
    [roomAllocator, published]
  );
  const timeAssignment = useMemo(
    () => assignTimes(published.system, published.settings, allocation),
    [published, allocation]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledExam[]>();
    for (const scheduled of published.system) {
      if (!filterExam(scheduled)) continue;
      const list = map.get(scheduled.date) ?? [];
      list.push(scheduled);
      map.set(scheduled.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.exam.course.number.localeCompare(b.exam.course.number));
    }
    return map;
  }, [published, filterExam]);

  const visiblePrograms = useMemo(() => {
    const numbers = new Set<string>();
    for (const list of byDate.values()) {
      for (const scheduled of list) {
        for (const slot of scheduled.exam.slots) numbers.add(slot.programNumber);
      }
    }
    return [...numbers];
  }, [byDate]);

  const { periods, programColors, programs } = published;
  const from = periods.reduce((min, p) => (p.startDate < min ? p.startDate : min), periods[0]?.startDate ?? "");
  const to = periods.reduce((max, p) => (p.endDate > max ? p.endDate : max), periods[0]?.endDate ?? "");

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
          const time = timeAssignment.bookings.get(exam.id);
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
    <>
      {visiblePrograms.length > 0 && (
        <div className="program-legend">
          <span className="t-label muted">{t("output.highlightLabel")}</span>
          {visiblePrograms.map((number) => {
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
    </>
  );
}
