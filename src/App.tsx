import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { WorkspaceShell } from './components/WorkspaceShell';

function TruthLensRoot() {
  const { user, loading } = useAuth();
  const [showWorkspace, setShowWorkspace] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm font-medium text-slate-500 dark:bg-[#0B1120] dark:text-slate-400">
        Loading TruthLens...
      </div>
    );
  }

  if (user && showWorkspace) {
    return <WorkspaceShell onBackToLanding={() => setShowWorkspace(false)} />;
  }

  return <LandingPage onEnterWorkspace={() => setShowWorkspace(true)} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <TruthLensRoot />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
