/**
 * Who is signed in. The session lives in an `HttpOnly` cookie the browser
 * sends automatically (`auth/api.ts`'s `credentials: "include"`) - never
 * read or held by this code, unlike the bearer token this used to keep in
 * `localStorage` (a script an XSS bug ran could have read that; it cannot
 * read this). The account behind that cookie - its role, and whether an
 * editor is still pending approval - is never trusted from a stale copy
 * either: every load calls the server's `/api/me` to re-derive it, so a
 * revoked account or an admin's approval takes effect the next time this
 * tab opens instead of a stale session outliving what the server actually
 * knows.
 */

import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { Account } from "./users";
import { RegisterInput, RegisterResult, fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister } from "./api";

export type LoginOutcome = "ok" | "invalid" | "pending" | "offline";

export interface AuthContextValue {
  account: Account | null;
  /** True while `/api/me` is still resolving whichever session cookie this tab was loaded with. */
  restoring: boolean;
  login: (username: string, password: string) => Promise<LoginOutcome>;
  register: (input: RegisterInput) => Promise<RegisterResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((found) => {
      if (!cancelled) {
        setAccount(found);
        setRestoring(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginOutcome> => {
    const result = await apiLogin(username, password);
    if (result.outcome !== "ok") return result.outcome;
    setAccount(result.account);
    return "ok";
  }, []);

  const register = useCallback((input: RegisterInput) => apiRegister(input), []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAccount(null);
  }, []);

  const value: AuthContextValue = { account, restoring, login, register, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth() was called outside an <AuthProvider>");
  }
  return context;
}
