import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { UserProfile } from '../types/forensics';

interface AuthContextValue {
  user: User | null;
  dbUser: UserProfile | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncProfile = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      setDbUser(null);
      return;
    }
    try {
      const res = await apiFetch<{ user: UserProfile }>(firebaseUser, '/api/me');
      setDbUser(res.user);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to synchronize analyst profile.');
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      await syncProfile(firebaseUser);
      setLoading(false);
    });
    return () => unsub();
  }, [syncProfile]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      await syncProfile(cred.user);
    } catch (err: any) {
      setAuthError(err?.message || 'Google sign-in was cancelled or failed.');
      throw err;
    }
  }, [syncProfile]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setDbUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await syncProfile(user);
  }, [syncProfile, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        dbUser,
        loading,
        authError,
        signInWithGoogle,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
