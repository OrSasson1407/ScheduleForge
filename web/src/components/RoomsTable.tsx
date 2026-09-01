/**
 * Entering the rooms of the campus by hand, row by row, as an alternative to
 * loading a rooms file (requirement 2.1, extended by the manual entry option).
 *
 * The table IS the data: every keystroke updates `props.rooms` directly
 * through `onChange`, the same array the rooms file loader also writes to -
 * loading a file and editing the table are two ways of reaching the same
 * state, never two separate copies of it.
 */

import { Room } from "../engine/model";
import { useTranslation } from "../i18n/LanguageContext";
import { Icon } from "./Icon";

interface Props {
  rooms: Room[];
  onChange: (rooms: Room[]) => void;
}

function isValidName(name: string): boolean {
  return name.trim().length > 0;
}

function isValidCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity > 0;
}

export function RoomsTable({ rooms, onChange }: Props) {
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<Room>) => {
    onChange(rooms.map((room, at) => (at === index ? { ...room, ...patch } : room)));
  };

  const remove = (index: number) => {
    onChange(rooms.filter((_, at) => at !== index));
  };

  const add = () => {
    onChange([...rooms, { name: "", capacity: 30, location: "" }]);
  };

  return (
    <div className="data-table-wrap">
      {rooms.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("manual.roomName")}</th>
              <th>{t("manual.roomCapacity")}</th>
              <th>{t("manual.roomLocation")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rooms.map((room, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    value={room.name}
                    className={isValidName(room.name) ? "" : "invalid"}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={room.capacity}
                    className={isValidCapacity(room.capacity) ? "" : "invalid"}
                    onChange={(event) => update(index, { capacity: Number(event.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={room.location}
                    onChange={(event) => update(index, { location: event.target.value })}
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
        {t("manual.addRoom")}
      </button>
    </div>
  );
}
