/**
 * React side of real-time collaboration: one WebSocket connection to
 * `server/index.js`, kept as local state the rest of the app reacts to.
 *
 * The hook owns the connection and the mutex state (who holds which lock); it
 * hands every incoming move and settings change to the caller through the
 * `handlers` it was given, because applying a remote move to the exam system on
 * screen is App's job, not this hook's - this hook only knows about the wire
 * protocol, not about exams.
 */

import { useCallback, useRef, useState } from "react";
import { Settings } from "../engine/settings";
import { ClientMessage, Role, ServerMessage, User } from "./types";

export type CollabStatus = "idle" | "connecting" | "open" | "closed" | "error";
export type CollabLocks = Record<string, { name: string; clientId: string }>;

export interface CollabHandlers {
  /** Fired once, right after joining, with whatever the room already holds. */
  onState?: (examDates: Record<string, string>, settings: Settings | null) => void;
  onMoved?: (examId: string, date: string, by: string) => void;
  onSettings?: (settings: Settings, by: string) => void;
  /** A lock or a move was refused - the caller can show it as a toast. */
  onDenied?: (examId: string, heldBy: string) => void;
}

export function useCollab(handlers: CollabHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<CollabStatus>("idle");
  const [users, setUsers] = useState<User[]>([]);
  const [locks, setLocks] = useState<CollabLocks>({});
  const [myClientId, setMyClientId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const connect = useCallback((url: string, room: string, name: string, role: Role) => {
    socketRef.current?.close();
    setStatus("connecting");
    setMyRole(role);
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("open");
      sendMessage({ type: "join", room, name, role });
    };

    socket.onclose = () => {
      setStatus((current) => (current === "idle" ? current : "closed"));
      setUsers([]);
      setLocks({});
    };

    socket.onerror = () => setStatus("error");

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (message.type) {
        case "state":
          setMyClientId(message.clientId);
          setUsers(message.users);
          setLocks(message.locks);
          handlersRef.current.onState?.(message.examDates, message.settings);
          break;
        case "presence":
          setUsers(message.users);
          break;
        case "lock-changed":
          setLocks((current) => {
            if (message.by === null || message.clientId === null) {
              const { [message.examId]: _removed, ...rest } = current;
              return rest;
            }
            return { ...current, [message.examId]: { name: message.by, clientId: message.clientId } };
          });
          break;
        case "lock-denied":
          handlersRef.current.onDenied?.(message.examId, message.heldBy);
          break;
        case "moved":
          handlersRef.current.onMoved?.(message.examId, message.date, message.by);
          break;
        case "settings":
          handlersRef.current.onSettings?.(message.settings, message.by);
          break;
      }
    };
  }, [sendMessage]);

  const disconnect = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("idle");
    setUsers([]);
    setLocks({});
    setMyClientId(null);
    setMyRole(null);
  }, []);

  const requestLock = useCallback((examId: string) => sendMessage({ type: "lock", examId }), [sendMessage]);
  const releaseLock = useCallback((examId: string) => sendMessage({ type: "unlock", examId }), [sendMessage]);
  const move = useCallback(
    (examId: string, date: string) => sendMessage({ type: "move", examId, date }),
    [sendMessage]
  );
  const sendSettings = useCallback(
    (settings: Settings) => sendMessage({ type: "settings", settings }),
    [sendMessage]
  );

  return {
    status,
    users,
    locks,
    myClientId,
    myRole,
    isConnected: status === "open",
    isViewer: status === "open" && myRole === "viewer",
    connect,
    disconnect,
    requestLock,
    releaseLock,
    move,
    sendSettings,
  };
}
