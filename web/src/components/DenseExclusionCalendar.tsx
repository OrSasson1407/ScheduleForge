/**
 * The exam periods screen's calendar: one dense column of small squares per
 * month, spanning every month the loaded exam periods touch.
 *
 * Every square is a real day - clicking it excludes or re-includes it
 * (requirement 2.4.2) - not a stand-in for one, so the range covers however
 * many months the periods actually span rather than a fixed year.
 */

import { ExamPeriod, datesBetween, isExcluded, toDisplayDate } from "../engine/model";
import { MONTH_KEYS } from "../i18n/domainLabels";
import { useTranslation } from "../i18n/LanguageContext";

interface Props {
  periods: ExamPeriod[];
  onDayClick: (iso: string) => void;
}

function periodOfDay(periods: ExamPeriod[], iso: string): ExamPeriod | undefined {
  return periods.find((period) => period.startDate <= iso && iso <= period.endDate);
}

export function DenseExclusionCalendar({ periods, onDayClick }: Props) {
  const { t } = useTranslation();
  if (!periods.length) return null;

  const from = periods.reduce((min, p) => (p.startDate < min ? p.startDate : min), periods[0].startDate);
  const to = periods.reduce((max, p) => (p.endDate > max ? p.endDate : max), periods[0].endDate);

  const months = new Map<string, string[]>();
  for (const iso of datesBetween(from, to)) {
    const key = iso.slice(0, 7);
    const list = months.get(key);
    if (list) list.push(iso);
    else months.set(key, [iso]);
  }

  return (
    <div className="dense-calendar">
      {[...months.entries()].map(([key, days]) => {
        const month = Number(key.slice(5, 7)) - 1;
        return (
          <div className="dense-month" key={key}>
            <div className="dense-month-label">
              {t(MONTH_KEYS[month])} {key.slice(0, 4)}
            </div>
            <div className="dense-days">
              {days.map((iso) => {
                const period = periodOfDay(periods, iso);
                if (!period) {
                  return <span key={iso} className="dense-day outside" title={toDisplayDate(iso)} />;
                }
                const excluded = isExcluded(period, iso);
                const date = toDisplayDate(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    className={`dense-day ${excluded ? "excluded" : "available"}`}
                    title={t(excluded ? "periods.dayTitleExcluded" : "periods.dayTitleAvailable", { date })}
                    onClick={() => onDayClick(iso)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
