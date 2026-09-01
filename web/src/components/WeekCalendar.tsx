/**
 * The output screen's calendar: one row per week, one column per day.
 *
 * A whole exam season does not fit on one screen, so the calendar scrolls
 * vertically through as many weeks as the selected exam periods span - it is
 * not trimmed to a fixed window. All seven days of the week are columns
 * (Sunday first, matching the working week this software is built for),
 * because an exam is legally free to land on any day that is not explicitly
 * excluded, Sunday included.
 */

import { DragEvent, ReactNode } from "react";
import { addDays, fromIso, toIso } from "../engine/model";
import { MONTH_KEYS, WEEKDAY_KEYS } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";

interface Props {
  from: string;
  to: string;
  dayClassName: (iso: string) => string;
  renderDay?: (iso: string) => ReactNode;
  dayTitle?: (iso: string) => string | undefined;
  onDayDragOver?: (iso: string, event: DragEvent) => void;
  onDayDrop?: (iso: string, event: DragEvent) => void;
}

function startOfWeek(iso: string): string {
  const date = fromIso(iso);
  date.setDate(date.getDate() - date.getDay());
  return toIso(date);
}

function weeksBetween(from: string, to: string): string[][] {
  const weeks: string[][] = [];
  let cursor = startOfWeek(from);
  while (cursor <= to) {
    const week: string[] = [];
    for (let day = 0; day < 7; day += 1) week.push(addDays(cursor, day));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function WeekCalendar({
  from,
  to,
  dayClassName,
  renderDay,
  dayTitle,
  onDayDragOver,
  onDayDrop,
}: Props) {
  const { t } = useTranslation();
  const weeks = weeksBetween(from, to);

  const shortDate = (iso: string): string => {
    const date = fromIso(iso);
    return `${String(date.getDate()).padStart(2, "0")} ${t(MONTH_KEYS[date.getMonth()])}`;
  };

  return (
    <div className="week-list">
      <div className="week-header">
        <div />
        {WEEKDAY_KEYS.map((key) => (
          <div className="week-header-cell" key={key}>
            {t(key)}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div className="week-row" key={week[0]}>
          <div className="week-label">{shortDate(week[0])}</div>
          {week.map((iso) => (
            <div
              key={iso}
              className={`day-cell ${dayClassName(iso)}`}
              title={dayTitle?.(iso)}
              onDragOver={onDayDragOver ? (event) => onDayDragOver(iso, event) : undefined}
              onDrop={onDayDrop ? (event) => onDayDrop(iso, event) : undefined}
            >
              <span className="day-cell-date">{shortDate(iso)}</span>
              {renderDay?.(iso)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
