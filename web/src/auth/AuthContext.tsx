/**
 * Who is signed in. The session token is kept in the browser's own storage
 * (`state/storage.ts`'s pattern) so a reload does not ask for the password
 * again, but the account behind it - its role, and whether an editor is
 * still pending approval - is never trusted from that stored copy: every
 * load calls the server's `/api/me` to re-derive it, so a revoked account or
 * an admin's approval takes effect the next time this tab opens instead of a
 * stale session outliving what the server actually knows.
 */

import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { Account } from "./users";
import { RegisterInput, RegisterResult, fetchMe, login as apiLogin, register as apiRegister } from "./api";

const STORAGE_KEY = "scheduleforge.v3.session";

function restoreToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* The session just will not survive a reload; nothing else depends on it. */
  }
}

export type LoginOutcome = "ok" | "invalid" | "pending" | "offline";

export interface AuthContextValue {
  account: Account | null;
  token: string | null;
  /** True while `/api/me` is still resolving the token this tab was restored with. */
  restoring: boolean;
  login: (username: string, password: string) => Promise<LoginOutcome>;
  register: (input: RegisterInput) => Promise<RegisterResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(restoreToken);
  const [account, setAccount] = useState<Account | null>(null);
  const [restoring, setRestoring] = useState(token !== null);

  useEffect(() => {
    if (!token) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    fetchMe(token).then((found) => {
      if (cancelled) return;
      if (found) {
        setAccount(found);
      } else {
        setToken(null);
        persistToken(null);
      }
      setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
    // Only re-run when the token itself changes (a fresh login), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const login = useCallback(async (username: string, password: string): Promise<LoginOutcome> => {
    const result = await apiLogin(username, password);
    if (result.outcome !== "ok") return result.outcome;
    setToken(result.token);
    setAccount(result.account);
    persistToken(result.token);
    return "ok";
  }, []);

  const register = useCallback((input: RegisterInput) => apiRegister(input), []);

  const logout = useCallback(() => {
    setToken(null);
    setAccount(null);
    persistToken(null);
  }, []);

  const value: AuthContextValue = { account, token, restoring, login, register, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth() was called outside an <AuthProvider>");
  }
  return context;
}
