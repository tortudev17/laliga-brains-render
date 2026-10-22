import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "../services/firebase/client";
import { firebaseRead, registerAccount } from "../services/api/client";
import type { UserProfile } from "../types/domain";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, role: UserProfile["role"]) => Promise<{ pendingApproval: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_CHECK_TIMEOUT_MS = 5000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authRevision = 0;
    let sessionCheckFinished = false;
    const finishSessionCheck = () => {
      if (sessionCheckFinished) return;
      sessionCheckFinished = true;
      window.clearTimeout(sessionCheckTimer);
      setLoading(false);
    };
    const sessionCheckTimer = window.setTimeout(finishSessionCheck, SESSION_CHECK_TIMEOUT_MS);
    const authUnsubscribe = onAuthStateChanged(auth, (nextUser) => {
      const revision = ++authRevision;
      setUser(nextUser);
      setProfile(null);
      if (!nextUser) {
        finishSessionCheck();
        return;
      }

      void firebaseRead<Omit<UserProfile, "uid">>(`laligaBrains/identity/users/${nextUser.uid}`).then((value) => {
        if (!active || revision !== authRevision) return;
        if (value) {
          const nextProfile = { uid: nextUser.uid, ...value } as UserProfile;
          setProfile(nextProfile);
          if (nextProfile.accountStatus !== "active" && nextUser.email?.toLowerCase() !== "holam@secure.com") void signOut(auth);
        } else {
          setProfile(null);
          void signOut(auth);
        }
      }).catch((error: unknown) => {
        if (active && revision === authRevision) console.error("No se pudo comprobar el estado de la cuenta.", error);
      }).finally(() => {
        if (active && revision === authRevision) finishSessionCheck();
      });
    }, (error) => {
      console.error("No se pudo comprobar la sesión.", error);
      finishSessionCheck();
    });
    return () => { active = false; window.clearTimeout(sessionCheckTimer); authUnsubscribe(); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading,
    login: async (username, password) => {
      const normalized = normalizeUsername(username);
      if (normalized === "piero") throw new Error("Entra mediante la opción Modo Piero para verificar primero el PIN.");
      const email = `${normalized}@laligabrains.com`;
      const result = await signInWithEmailAndPassword(auth, email, password);
      const profile = await firebaseRead<Omit<UserProfile, "uid">>(`laligaBrains/identity/users/${result.user.uid}`);
      if (!profile || profile.accountStatus !== "active") {
        await signOut(auth);
        throw new Error(profile?.accountStatus === "pending_approval" ? "Tu solicitud de acceso está pendiente de aprobación." : "Tu cuenta no tiene acceso activo.");
      }
    },
    register: async (username, password, role) => {
      const result = await registerAccount(username, password, role);
      if (!result.pendingApproval) await signInWithEmailAndPassword(auth, `${normalizeUsername(username)}@laligabrains.com`, password);
      return result;
    },
    logout: () => signOut(auth),
  }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return context;
}

export function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLowerCase();
}
