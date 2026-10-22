import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { get, onValue, ref } from "firebase/database";
import { auth, database } from "../services/firebase/client";
import { registerAccount } from "../services/api/client";
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
    let profileUnsubscribe: (() => void) | undefined;
    let sessionCheckFinished = false;
    const finishSessionCheck = () => {
      if (sessionCheckFinished) return;
      sessionCheckFinished = true;
      window.clearTimeout(sessionCheckTimer);
      setLoading(false);
    };
    const sessionCheckTimer = window.setTimeout(finishSessionCheck, SESSION_CHECK_TIMEOUT_MS);
    const authUnsubscribe = onAuthStateChanged(auth, (nextUser) => {
      profileUnsubscribe?.();
      profileUnsubscribe = undefined;
      setUser(nextUser);
      setProfile(null);
      if (nextUser && database) {
        profileUnsubscribe = onValue(ref(database, `laligaBrains/identity/users/${nextUser.uid}`), (snapshot) => {
          if (snapshot.exists()) {
            const nextProfile = { uid: nextUser.uid, ...snapshot.val() } as UserProfile;
            setProfile(nextProfile);
            if (nextProfile.accountStatus !== "active" && nextUser.email?.toLowerCase() !== "holam@secure.com") void signOut(auth);
          }
          else { setProfile(null); void signOut(auth); }
          finishSessionCheck();
        }, (error) => {
          console.error("No se pudo comprobar el estado de la cuenta.", error);
          finishSessionCheck();
        });
      } else {
        finishSessionCheck();
      }
    }, (error) => {
      console.error("No se pudo comprobar la sesión.", error);
      finishSessionCheck();
    });
    return () => { window.clearTimeout(sessionCheckTimer); authUnsubscribe(); profileUnsubscribe?.(); };
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
      if (!database) throw new Error("Firebase no está disponible en este navegador.");
      const profile = (await get(ref(database, `laligaBrains/identity/users/${result.user.uid}`))).val() as UserProfile | null;
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
