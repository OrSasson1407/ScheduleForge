/**
 * Real-time collaboration: joining a room, and who else is in it.
 *
 * A small panel dropped from the header, so it stays reachable from every
 * screen - a peer's move or settings change can arrive while looking at the
 * settings screen just as well as the output screen.
 */

import { useState } from "react";
import { Icon } from "./Icon";
import { CollabStatus } from "../collab/useCollab";
import { Role, User } from "../collab/types";
import { TranslationKey } from "../i18n/types";
import { useTranslation } from "../i18n/LanguageContext";

/** `VITE_WS_URL` is a build-time value - see `auth/api.ts`'s `baseUrl` for why one is needed at all in production. */
function defaultServerUrl(): string {
  return import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:8787`;
}

interface Props {
  status: CollabStatus;
  users: User[];
  myClientId: string | null;
  onConnect: (url: string, room: string, name: string, role: Role) => void;
  onDisconnect: () => void;
}

const STATUS_KEY: Record<CollabStatus, TranslationKey> = {
  idle: "collab.statusIdle",
  connecting: "collab.statusConnecting",
  open: "collab.statusOpen",
  closed: "collab.statusClosed",
  error: "collab.statusError",
};

export function CollabBar({ status, users, myClientId, onConnect, onDisconnect }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [server, setServer] = useState(defaultServerUrl());
  const [room, setRoom] = useState("default");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const myRole = users.find((user) => user.clientId === myClientId)?.role ?? null;

  return (
    <div className="collab">
      <button
        type="button"
        className={`tab ${status === "open" ? "collab-on" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name={myRole === "viewer" ? "visibility" : "group"} />
        {status === "open" ? t("collab.tabConnected", { room, count: users.length }) : t("collab.tabIdle")}
      </button>

      {open && (
        <div className="collab-panel">
          {status !== "open" ? (
            <>
              <label>
                {t("collab.formServer")}
                <input type="text" value={server} onChange={(event) => setServer(event.target.value)} />
              </label>
              <label>
                {t("collab.formRoomCode")}
                <input type="text" value={room} onChange={(event) => setRoom(event.target.value)} />
              </label>
              <label>
                {t("collab.formYourName")}
                <input
                  type="text"
                  value={name}
                  placeholder={t("collab.namePlaceholder")}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <fieldset className="role-choice">
                <legend>{t("collab.joinAsLegend")}</legend>
                <label>
                  <input
                    type="radio"
                    name="collab-role"
                    checked={role === "editor"}
                    onChange={() => setRole("editor")}
                  />
                  {t("collab.roleEditor")}
                </label>
                <label>
                  <input
                    type="radio"
                    name="collab-role"
                    checked={role === "viewer"}
                    onChange={() => setRole("viewer")}
                  />
                  {t("collab.roleViewer")}
                </label>
              </fieldset>
              <button
                type="button"
                className="primary"
                disabled={!name.trim() || status === "connecting"}
                onClick={() => onConnect(server, room.trim() || "default", name.trim(), role)}
              >
                <Icon name="login" />
                {t("collab.joinButton")}
              </button>
              <p className="hint">{t(STATUS_KEY[status])}</p>
            </>
          ) : (
            <>
              <p className="hint">
                {t("collab.roomStatus", {
                  room,
                  status: t(STATUS_KEY[status]),
                  viewerNote: myRole === "viewer" ? t("collab.viewerNote") : "",
                })}
              </p>
              <div className="collab-users">
                {users.map((user) => (
                  <span
                    className={`user-pill ${user.clientId === myClientId ? "me" : ""} ${
                      user.role === "viewer" ? "viewer" : ""
                    }`}
                    key={user.clientId}
                  >
                    <Icon name={user.role === "viewer" ? "visibility" : "edit"} />
                    {user.name}
                    {user.clientId === myClientId ? t("collab.youSuffix") : ""}
                  </span>
                ))}
              </div>
              <button type="button" className="secondary" onClick={onDisconnect}>
                <Icon name="logout" />
                {t("collab.leaveButton")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
