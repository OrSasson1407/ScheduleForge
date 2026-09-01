/**
 * Requirement 2.4 - looking at the exam periods of the year and editing them.
 *
 * 2.4.1 a year calendar that sums up the current state,
 * 2.4.2 a click on a day takes it out of the exam calendar, or puts it back,
 * 2.4.3 the start and the end of every exam period can be moved.
 */

import { useState } from "react";
import { DenseExclusionCalendar } from "./DenseExclusionCalendar";
import { Icon } from "./Icon";
import { replacePeriod, setPeriodDates, toggleExcludedDay } from "../engine/edits";
import {
  ExamPeriod,
  MOADIM,
  MOED_ORDER,
  Moed,
  SEMESTERS,
  SEMESTER_ORDER,
  Semester,
  availableDates,
  periodKey,
  toIso,
} from "../engine/model";
import { MOED_KEY, SEMESTER_KEY } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";

interface Props {
  periods: ExamPeriod[];
  onChange: (periods: ExamPeriod[]) => void;
}

function sorted(periods: ExamPeriod[]): ExamPeriod[] {
  return [...periods].sort(
    (a, b) =>
      SEMESTER_ORDER[a.semester] - SEMESTER_ORDER[b.semester] ||
      MOED_ORDER[a.moed] - MOED_ORDER[b.moed]
  );
}

function periodOfDay(periods: ExamPeriod[], iso: string): ExamPeriod | undefined {
  return periods.find((period) => period.startDate <= iso && iso <= period.endDate);
}

/** Every (semester, moed) pair `periods` does not already define one of. */
function missingCombos(periods: ExamPeriod[]): { semester: Semester; moed: Moed }[] {
  const taken = new Set(periods.map((period) => periodKey(period.semester, period.moed)));
  const combos: { semester: Semester; moed: Moed }[] = [];
  for (const semester of SEMESTERS) {
    for (const moed of MOADIM) {
      if (!taken.has(periodKey(semester, moed))) combos.push({ semester, moed });
    }
  }
  return combos;
}

/** A new period's default dates: today, and three weeks after it. */
function defaultDates(): { startDate: string; endDate: string } {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 21);
  return { startDate: toIso(start), endDate: toIso(end) };
}

function AddPeriod({ periods, onChange }: Props) {
  const { t } = useTranslation();
  const combos = missingCombos(periods);
  const [choice, setChoice] = useState(0);
  if (!combos.length) return null;

  const add = () => {
    const { semester, moed } = combos[Math.min(choice, combos.length - 1)];
    onChange([...periods, { semester, moed, ...defaultDates(), excluded: [] }]);
  };

  return (
    <div className="add-period">
      <select value={choice} onChange={(event) => setChoice(Number(event.target.value))}>
        {combos.map((combo, index) => (
          <option key={periodKey(combo.semester, combo.moed)} value={index}>
            {t(SEMESTER_KEY[combo.semester])} · {t(MOED_KEY[combo.moed])}
          </option>
        ))}
      </select>
      <button type="button" className="secondary" onClick={add}>
        <Icon name="add" />
        {t("periods.addPeriod")}
      </button>
    </div>
  );
}

export function PeriodsSection({ periods, onChange }: Props) {
  const { t } = useTranslation();
  const ordered = sorted(periods);

  const clickDay = (iso: string) => {
    const period = periodOfDay(ordered, iso);
    if (!period) return;
    onChange(replacePeriod(periods, toggleExcludedDay(period, iso)));
  };

  const changeDates = (period: ExamPeriod, startDate: string, endDate: string) => {
    if (!startDate || !endDate || startDate >= endDate) return;
    onChange(replacePeriod(periods, setPeriodDates(period, startDate, endDate)));
  };

  const removePeriod = (period: ExamPeriod) => {
    onChange(periods.filter((item) => periodKey(item.semester, item.moed) !== periodKey(period.semester, period.moed)));
  };

  if (!ordered.length) {
    return (
      <div className="panel">
        <div className="panel-title">
          <Icon name="event_busy" />
          <h2 className="t-section">{t("periods.title")}</h2>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          {t("periods.loadHint")}
        </p>
        <div style={{ marginTop: 12 }}>
          <AddPeriod periods={periods} onChange={onChange} />
        </div>
      </div>
    );
  }

  return (
    <div className="col">
      <div className="panel">
        <div className="panel-title">
          <Icon name="date_range" />
          <h2 className="t-section">{t("periods.title")}</h2>
        </div>
        <table className="periods" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{t("periods.colSemester")}</th>
              <th>{t("periods.colMoed")}</th>
              <th>{t("periods.colStartDate")}</th>
              <th>{t("periods.colEndDate")}</th>
              <th className="numeric">{t("periods.colDaysAvailable")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((period) => {
              const key = `${period.semester}|${period.moed}`;
              return (
                <tr key={key}>
                  <td>{t(SEMESTER_KEY[period.semester])}</td>
                  <td>{t(MOED_KEY[period.moed])}</td>
                  <td>
                    <input
                      type="date"
                      value={period.startDate}
                      onChange={(event) => changeDates(period, event.target.value, period.endDate)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={period.endDate}
                      onChange={(event) => changeDates(period, period.startDate, event.target.value)}
                    />
                  </td>
                  <td className="numeric">{availableDates(period).length}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost row-delete"
                      onClick={() => removePeriod(period)}
                      aria-label={t("manual.removeRow")}
                    >
                      <Icon name="delete" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 12 }}>
          <AddPeriod periods={periods} onChange={onChange} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <Icon name="grid_view" />
          <h2 className="t-section">{t("periods.exclusionTitle")}</h2>
          <div className="legend-row">
            <span className="legend-swatch">
              <span className="legend-chip available" /> {t("periods.available")}
            </span>
            <span className="legend-swatch">
              <span className="legend-chip excluded" /> {t("periods.excluded")}
            </span>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <DenseExclusionCalendar periods={ordered} onDayClick={clickDay} />
        </div>
      </div>
    </div>
  );
}
