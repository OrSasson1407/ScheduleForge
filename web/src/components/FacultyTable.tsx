/**
 * Entering the dates an instructor is not available on, by hand, as an
 * alternative to loading a staff constraints file.
 *
 * `FacultyRules` is a plain `Record<instructor, ExcludedDates[]>`, so this
 * table works on an array view of its entries - `{ instructor, excluded }[]`
 * - and rebuilds the record from it on every change; that is also what makes
 * renaming an instructor safe: the old key is never left behind, because the
 * whole record is rebuilt from the current names, not patched in place.
 */

import { ExcludedDates, FacultyRules, fromDisplayDate, toDisplayDate } from "../engine/model";
import { useTranslation } from "../i18n/LanguageContext";
import { Icon } from "./Icon";

interface Props {
  faculty: FacultyRules;
  onChange: (faculty: FacultyRules) => void;
}

interface Entry {
  instructor: string;
  excluded: ExcludedDates[];
}

function toEntries(faculty: FacultyRules): Entry[] {
  return Object.entries(faculty).map(([instructor, excluded]) => ({ instructor, excluded }));
}

function toFaculty(entries: Entry[]): FacultyRules {
  const rules: FacultyRules = {};
  for (const entry of entries) rules[entry.instructor] = entry.excluded;
  return rules;
}

export function FacultyTable({ faculty, onChange }: Props) {
  const { t } = useTranslation();
  const entries = toEntries(faculty);

  const updateEntries = (next: Entry[]) => onChange(toFaculty(next));

  const renameInstructor = (index: number, name: string) => {
    updateEntries(entries.map((entry, at) => (at === index ? { ...entry, instructor: name } : entry)));
  };

  const removeInstructor = (index: number) => {
    updateEntries(entries.filter((_, at) => at !== index));
  };

  const addInstructor = () => {
    updateEntries([...entries, { instructor: "", excluded: [] }]);
  };

  const addExcluded = (index: number) => {
    const today = toDisplayDate(new Date().toISOString().slice(0, 10));
    updateEntries(
      entries.map((entry, at) =>
        at === index
          ? { ...entry, excluded: [...entry.excluded, { start: fromDisplayDate(today)!, end: fromDisplayDate(today)!, comment: "" }] }
          : entry
      )
    );
  };

  const updateExcluded = (index: number, at: number, patch: Partial<ExcludedDates>) => {
    updateEntries(
      entries.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, excluded: entry.excluded.map((rule, ruleIndex) => (ruleIndex === at ? { ...rule, ...patch } : rule)) }
          : entry
      )
    );
  };

  const removeExcluded = (index: number, at: number) => {
    updateEntries(
      entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, excluded: entry.excluded.filter((_, ruleIndex) => ruleIndex !== at) } : entry
      )
    );
  };

  return (
    <div className="data-table-wrap">
      {entries.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("manual.instructorName")}</th>
              <th>{t("manual.instructorDatesOut")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    value={entry.instructor}
                    className={entry.instructor.trim() ? "" : "invalid"}
                    onChange={(event) => renameInstructor(index, event.target.value)}
                  />
                </td>
                <td>
                  <div className="excluded-list">
                    {entry.excluded.map((rule, at) => (
                      <div className="excluded-row" key={at}>
                        <input
                          type="date"
                          value={rule.start}
                          onChange={(event) => updateExcluded(index, at, { start: event.target.value })}
                        />
                        <span className="muted">-</span>
                        <input
                          type="date"
                          value={rule.end}
                          onChange={(event) => updateExcluded(index, at, { end: event.target.value })}
                        />
                        <input
                          type="text"
                          className="excluded-comment"
                          placeholder={t("manual.commentPlaceholder")}
                          value={rule.comment}
                          onChange={(event) => updateExcluded(index, at, { comment: event.target.value })}
                        />
                        <button
                          type="button"
                          className="ghost row-delete"
                          onClick={() => removeExcluded(index, at)}
                          aria-label={t("manual.removeRow")}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="link" onClick={() => addExcluded(index)}>
                      <Icon name="add" />
                      {t("manual.addDateRange")}
                    </button>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className="ghost row-delete"
                    onClick={() => removeInstructor(index)}
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
      <button type="button" className="secondary table-add-row" onClick={addInstructor}>
        <Icon name="add" />
        {t("manual.addInstructor")}
      </button>
    </div>
  );
}
