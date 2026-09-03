/**
 * The settings screen (requirement sections 2 and 3 of version 3.0).
 *
 * Section 2 - every threshold requirement is turned on or left off, and the one
 * that is on carries its own k. A system that does not meet it is disqualified.
 *
 * Section 3 - the criteria the systems that passed are sorted by. The user puts
 * them in the order of preference: the first decides, the second breaks its
 * ties, and so on. Every criterion is shown in descending order of its value.
 */

import { useState } from "react";
import { Icon } from "../components/Icon";
import { SORT_CRITERIA, Settings, SortCriterion } from "../engine/settings";
import { parseTimeSlots } from "../engine/timeAssignment";
import { useTranslation } from "../i18n/LanguageContext";
import { TranslationKey } from "../i18n/types";

interface Props {
  settings: Settings;
  hasRooms: boolean;
  onChange: (settings: Settings) => void;
  onRun: () => void;
  canRun: boolean;
  /** Set while connected to a collaboration room as a viewer: every control here is read-only. */
  readOnly?: boolean;
}

const CRITERION_KEY: Record<SortCriterion, TranslationKey> = {
  min_days_between_obligatory: "settings.criteria.min_days_between_obligatory",
  average_days_between_exams: "settings.criteria.average_days_between_exams",
  elective_collisions: "settings.criteria.elective_collisions",
  obligatory_span: "settings.criteria.obligatory_span",
  max_exams_per_day: "settings.criteria.max_exams_per_day",
  min_gap_between_moeds: "settings.criteria.min_gap_between_moeds",
  worst_window_count: "settings.criteria.worst_window_count",
};

interface ThresholdProps {
  icon: string;
  label: string;
  hint: string;
  value: number | null;
  least: number;
  onChange: (value: number | null) => void;
}

function Threshold({ icon, label, hint, value, least, onChange }: ThresholdProps) {
  const { t } = useTranslation();
  const isOn = value !== null;
  return (
    <div className={`threshold-card ${isOn ? "on" : ""}`} title={hint}>
      <div className="threshold-head">
        <label className="threshold-check">
          <input
            type="checkbox"
            checked={isOn}
            onChange={(event) => onChange(event.target.checked ? Math.max(least, 1) : null)}
          />
          <span className="label">{label}</span>
        </label>
        <Icon name={icon} />
      </div>
      <div className={`threshold-value ${isOn ? "" : "disabled"}`}>
        <span className="t-label">{t("settings.kValue")}</span>
        <input
          type="number"
          min={least}
          value={value ?? ""}
          disabled={!isOn}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next) && next >= least) onChange(next);
          }}
        />
      </div>
    </div>
  );
}

export function SettingsScreen({ settings, hasRooms, onChange, onRun, canRun, readOnly }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const [timeSlotsText, setTimeSlotsText] = useState(settings.timeSlots.join(", "));

  const toggleCriterion = (criterion: SortCriterion) => {
    const chosen = settings.sortCriteria.includes(criterion)
      ? settings.sortCriteria.filter((item) => item !== criterion)
      : [...settings.sortCriteria, criterion];
    set({ sortCriteria: chosen });
  };

  const move = (criterion: SortCriterion, by: number) => {
    const chosen = [...settings.sortCriteria];
    const at = chosen.indexOf(criterion);
    const to = at + by;
    if (at < 0 || to < 0 || to >= chosen.length) return;
    chosen.splice(to, 0, chosen.splice(at, 1)[0]);
    set({ sortCriteria: chosen });
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="t-display">{t("settings.headerTitle")}</h1>
        <p>{t("settings.headerDescription")}</p>
      </div>

      {readOnly && <p className="notice">{t("settings.readOnlyNotice")}</p>}

      <fieldset className="settings-columns" disabled={readOnly}>
        <div className="panel-glass">
          <div className="panel-title">
            <Icon name="tune" />
            <h2 className="t-section">{t("settings.thresholdsTitle")}</h2>
          </div>
          <p className="hint">{t("settings.thresholdsDescription")}</p>
          <div className="thresholds">
            <Threshold
              icon="calendar_month"
              label={t("settings.minObligatoryLabel")}
              hint={t("settings.minObligatoryHint")}
              value={settings.minDaysBetweenObligatory}
              least={1}
              onChange={(value) => set({ minDaysBetweenObligatory: value })}
            />
            <Threshold
              icon="date_range"
              label={t("settings.minAnyLabel")}
              hint={t("settings.minAnyHint")}
              value={settings.minDaysBetweenAny}
              least={1}
              onChange={(value) => set({ minDaysBetweenAny: value })}
            />
            <Threshold
              icon="call_merge"
              label={t("settings.maxCollisionsLabel")}
              hint={t("settings.maxCollisionsHint")}
              value={settings.maxElectiveCollisions}
              least={0}
              onChange={(value) => set({ maxElectiveCollisions: value })}
            />
            <Threshold
              icon="linear_scale"
              label={t("settings.minSpanLabel")}
              hint={t("settings.minSpanHint")}
              value={settings.minObligatorySpan}
              least={1}
              onChange={(value) => set({ minObligatorySpan: value })}
            />
            <Threshold
              icon="warning"
              label={t("settings.maxPerDayLabel")}
              hint={t("settings.maxPerDayHint")}
              value={settings.maxExamsPerDay}
              least={1}
              onChange={(value) => set({ maxExamsPerDay: value })}
            />
            <Threshold
              icon="event_repeat"
              label={t("settings.minGapBetweenMoedsLabel")}
              hint={t("settings.minGapBetweenMoedsHint")}
              value={settings.minGapBetweenMoeds}
              least={1}
              onChange={(value) => set({ minGapBetweenMoeds: value })}
            />
            <div
              className={`threshold-card ${settings.maxExamsPerWindow !== null ? "on" : ""}`}
              title={t("settings.maxPerWindowHint")}
            >
              <div className="threshold-head">
                <label className="threshold-check">
                  <input
                    type="checkbox"
                    checked={settings.maxExamsPerWindow !== null}
                    onChange={(event) =>
                      set(
                        event.target.checked
                          ? { maxExamsPerWindow: 2, windowDays: 3 }
                          : { maxExamsPerWindow: null, windowDays: null }
                      )
                    }
                  />
                  <span className="label">{t("settings.maxPerWindowLabel")}</span>
                </label>
                <Icon name="view_week" />
              </div>
              <div className={`threshold-value ${settings.maxExamsPerWindow !== null ? "" : "disabled"}`}>
                <span className="t-label">{t("settings.kValue")}</span>
                <input
                  type="number"
                  min={1}
                  value={settings.maxExamsPerWindow ?? ""}
                  disabled={settings.maxExamsPerWindow === null}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 1) set({ maxExamsPerWindow: next });
                  }}
                />
                <span className="t-label">{t("settings.windowDaysLabel")}</span>
                <input
                  type="number"
                  min={1}
                  value={settings.windowDays ?? ""}
                  disabled={settings.windowDays === null}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 1) set({ windowDays: next });
                  }}
                />
              </div>
            </div>
            <div
              className={`threshold-card rooms ${settings.requireRooms ? "on" : ""}`}
              onClick={() => hasRooms && set({ requireRooms: !settings.requireRooms })}
            >
              <Icon name="meeting_room" className="big" />
              <div className="rooms-toggle">
                <input
                  type="checkbox"
                  checked={settings.requireRooms}
                  disabled={!hasRooms}
                  onChange={(event) => {
                    event.stopPropagation();
                    set({ requireRooms: event.target.checked });
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="t-headline-md">{t("settings.requireRooms")}</span>
              </div>
              <span className="t-micro muted">
                {hasRooms ? t("settings.requireRoomsHintOn") : t("settings.requireRoomsHintOff")}
              </span>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="panel-glass">
            <div className="panel-title">
              <Icon name="sort" />
              <h2 className="t-section" style={{ flex: 1 }}>
                {t("settings.sortingTitle")}
              </h2>
              <span className="t-label muted">{t("settings.sortingPriority")}</span>
            </div>
            <p className="hint">{t("settings.sortingDescription")}</p>
            <div className="criteria">
              {SORT_CRITERIA.map((criterion) => {
                const at = settings.sortCriteria.indexOf(criterion);
                const chosen = at >= 0;
                return (
                  <div className={`criterion ${chosen ? "on" : ""}`} key={criterion}>
                    <div className="criterion-arrows">
                      <button
                        type="button"
                        disabled={!chosen || at === 0}
                        onClick={() => move(criterion, -1)}
                        aria-label={t("settings.moveUp")}
                      >
                        <Icon name="expand_less" />
                      </button>
                      <button
                        type="button"
                        disabled={!chosen || at === settings.sortCriteria.length - 1}
                        onClick={() => move(criterion, 1)}
                        aria-label={t("settings.moveDown")}
                      >
                        <Icon name="expand_more" />
                      </button>
                    </div>
                    <div className="criterion-rank t-data">{chosen ? `#${at + 1}` : "-"}</div>
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen}
                        onChange={() => toggleCriterion(criterion)}
                      />
                      {t(CRITERION_KEY[criterion])}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel-glass">
            <div className="panel-title">
              <Icon name="memory" />
              <h2 className="t-section">{t("settings.boundsTitle")}</h2>
            </div>
            <div className="limits">
              <label>
                {t("settings.systemsToKeep")}
                <input
                  type="number"
                  min={1}
                  value={settings.maxCandidates}
                  onChange={(event) => set({ maxCandidates: Number(event.target.value) })}
                />
              </label>
              <label>
                {t("settings.systemsToExamine")}
                <input
                  type="number"
                  min={1}
                  value={settings.maxExamined}
                  onChange={(event) => set({ maxExamined: Number(event.target.value) })}
                />
              </label>
              <label>
                {t("settings.timeLimitSeconds")}
                <input
                  type="number"
                  min={1}
                  value={settings.timeLimitSeconds}
                  onChange={(event) => set({ timeLimitSeconds: Number(event.target.value) })}
                />
              </label>
              <label>
                {t("settings.defaultStudents")}
                <input
                  type="number"
                  min={1}
                  value={settings.defaultStudents}
                  onChange={(event) => set({ defaultStudents: Number(event.target.value) })}
                />
              </label>
            </div>
          </div>

          <div className="panel-glass">
            <div className="panel-title">
              <Icon name="schedule" />
              <h2 className="t-section">{t("settings.hourOfDayTitle")}</h2>
            </div>
            <p className="hint">{t("settings.hourOfDayDescription")}</p>
            <div className="limits">
              <label style={{ gridColumn: "1 / -1" }}>
                {t("settings.timeSlotsLabel")}
                <input
                  type="text"
                  value={timeSlotsText}
                  placeholder={t("settings.timeSlotsPlaceholder")}
                  onChange={(event) => setTimeSlotsText(event.target.value)}
                  onBlur={() => set({ timeSlots: parseTimeSlots(timeSlotsText) })}
                />
              </label>
              <label>
                {t("settings.defaultExamMinutes")}
                <input
                  type="number"
                  min={1}
                  value={settings.defaultExamMinutes}
                  onChange={(event) => set({ defaultExamMinutes: Number(event.target.value) })}
                />
              </label>
            </div>
            <label className="threshold-check" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={settings.enforceTimeSlots}
                onChange={(event) => set({ enforceTimeSlots: event.target.checked })}
              />
              <span className="label">{t("settings.enforceTimeSlotsLabel")}</span>
            </label>
            <p className="hint">{t("settings.enforceTimeSlotsHint")}</p>
          </div>

          <div>
            <button type="button" className="settings-run" disabled={!canRun} onClick={onRun}>
              <Icon name="save" />
              {t("settings.saveButton")}
            </button>
            <p className="hint" style={{ textAlign: "center", marginTop: 8 }}>
              {canRun ? t("settings.saveHintReady") : t("settings.saveHintNotReady")}
            </p>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
