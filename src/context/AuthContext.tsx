import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getAdditionalUserInfo,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { UserProfile } from '../types/forensics';

const UID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const inFlightFirestoreSync = new Map<string, Promise<void>>();
const inFlightProfileSync = new Map<string, Promise<UserProfile>>();

function formatAuthError(err: any): string {
  const code = String(err?.code || '');
  if (code === 'auth/popup-closed-by-user') {
    return 'Google sign-in popup was closed before completing.';
  }
  if (code === 'auth/cancelled-popup-request') {
    return 'Sign-in request was superseded by another popup.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This preview domain is not authorized in Firebase Authentication.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google Sign-In is not enabled for this Firebase project.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while contacting Firebase Authentication. Please check your connection and try again.';
  }
  if (code === 'auth/user-disabled') {
    return 'This account has been disabled in Firebase Authentication.';
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return 'An account already exists with this email using a different sign-in provider.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many sign-in attempts. Please wait a moment and try again.';
  }

  const rawMsg = typeof err?.message === 'string' ? err.message : '';
  if (rawMsg.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawMsg);
      if (parsed?.error) {
        return `Unable to synchronize your Firestore profile: ${parsed.error}`;
      }
    } catch {
      // fall through
    }
  }
  return rawMsg || 'Google sign-in failed. Please try again.';
}

async function performFirestoreUserProfileSync(firebaseUser: User): Promise<void> {
  if (!firebaseUser.uid || !UID_REGEX.test(firebaseUser.uid) || firebaseUser.uid.length > 128) {
    return;
  }
  const email = (firebaseUser.email || '').trim().slice(0, 320);
  if (!email || !firebaseUser.emailVerified) {
    return;
  }

  const displayName = (firebaseUser.displayName || '').trim().slice(0, 120);
  const photoUrl = (firebaseUser.photoURL || '').trim().slice(0, 1024);
  const userPath = `users/${firebaseUser.uid}`;
  const userRef = doc(db, 'users', firebaseUser.uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!existingSnap.exists()) {
    try {
      await setDoc(userRef, {
        uid: firebaseUser.uid,
        email,
        displayName,
        photoUrl,
        provider: 'google.com',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  } else {
    try {
      await updateDoc(userRef, {
        email,
        displayName,
        photoUrl,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }
  }
}

function syncFirestoreUserProfile(firebaseUser: User): Promise<void> {
  const existingPromise = inFlightFirestoreSync.get(firebaseUser.uid);
  if (existingPromise) {
    return existingPromise;
  }
  const syncPromise = performFirestoreUserProfileSync(firebaseUser).finally(() => {
    inFlightFirestoreSync.delete(firebaseUser.uid);
  });
  inFlightFirestoreSync.set(firebaseUser.uid, syncPromise);
  return syncPromise;
}

interface AuthContextValue {
  user: User | null;
  dbUser: UserProfile | null;
  loading: boolean;
  isNewUser: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<boolean>;
  signUpWithGoogle: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncProfile = useCallback(async (firebaseUser: User | null, throwOnError = false) => {
    if (!firebaseUser) {
      setDbUser(null);
      return;
    }
    try {
      let profilePromise = inFlightProfileSync.get(firebaseUser.uid);
      if (!profilePromise) {
        profilePromise = (async () => {
          await firebaseUser.getIdToken();
          await syncFirestoreUserProfile(firebaseUser);
          const res = await apiFetch<{ user: UserProfile }>(firebaseUser, '/api/me');
          return res.user;
        })().finally(() => {
          inFlightProfileSync.delete(firebaseUser.uid);
        });
        inFlightProfileSync.set(firebaseUser.uid, profilePromise);
      }
      const syncedUser = await profilePromise;
      setDbUser(syncedUser);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(formatAuthError(err));
      if (throwOnError) {
        throw err;
      }
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await syncProfile(firebaseUser, false);
      } else {
        setDbUser(null);
        setIsNewUser(false);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [syncProfile]);

  const authenticateWithGoogle = useCallback(async (): Promise<boolean> => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const additional = getAdditionalUserInfo(cred);
      const newlyCreated = Boolean(additional?.isNewUser);
      setIsNewUser(newlyCreated);
      setUser(cred.user);
      await syncProfile(cred.user, true);
      return newlyCreated;
    } catch (err: any) {
      setAuthError(formatAuthError(err));
      throw err;
    }
  }, [syncProfile]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setUser(null);
    setDbUser(null);
    setIsNewUser(false);
    setAuthError(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await syncProfile(user, true);
  }, [syncProfile, user]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        dbUser,
        loading,
        isNewUser,
        authError,
        clearAuthError,
        signInWithGoogle: authenticateWithGoogle,
        signUpWithGoogle: authenticateWithGoogle,
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
