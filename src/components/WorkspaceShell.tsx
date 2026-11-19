import {
  Columns2,
  FolderSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  PlusCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../context/ThemeContext';
import { apiFetch } from '../lib/api';
import { exportForensicPdfReport } from '../lib/pdfReport';
import { DashboardData, InvestigationDetail } from '../types/forensics';
import { CaseWorkspaceView } from './views/CaseWorkspaceView';
import { CompareImagesView } from './views/CompareImagesView';
import { DashboardView } from './views/DashboardView';
import { NewInvestigationView } from './views/NewInvestigationView';
import { SettingsView } from './views/SettingsView';

export type SimpleTab = 'overview' | 'case' | 'new' | 'compare' | 'settings';

const NAV_ITEMS: Array<{
  id: SimpleTab;
  label: string;
  breadcrumb: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: 'Dashboard', breadcrumb: 'DASHBOARD', icon: LayoutDashboard },
  { id: 'case', label: 'Case Results & Inspector', breadcrumb: 'CASE_INSPECTOR', icon: FolderSearch },
  { id: 'new', label: 'New Investigation', breadcrumb: 'NEW_INVESTIGATION', icon: PlusCircle },
  { id: 'compare', label: 'Photo Comparison', breadcrumb: 'PHOTO_COMPARE', icon: Columns2 },
  { id: 'settings', label: 'Engine & Settings', breadcrumb: 'ENGINE_SETTINGS', icon: SlidersHorizontal },
];

export function WorkspaceShell({ onBackToLanding }: { onBackToLanding: () => void }) {
  const { user, dbUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<SimpleTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [activeInvestigation, setActiveInvestigation] = useState<InvestigationDetail | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [queuedQuickFiles, setQueuedQuickFiles] = useState<File[]>([]);
  const [engineReadyCount, setEngineReadyCount] = useState<{
    active: number;
    total: number;
  } | null>(null);

  const loadInvestigation = useCallback(
    async (id: number) => {
      if (!user) return;
      try {
        const res = await apiFetch<{ investigation: InvestigationDetail }>(
          user,
          `/api/investigations/${id}`
        );
        setActiveInvestigation(res.investigation);
      } catch (err: any) {
        setWorkspaceError(err?.message || 'Failed to load investigation.');
      }
    },
    [user]
  );

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoadingDashboard(true);
    setWorkspaceError(null);
    try {
      const data = await apiFetch<DashboardData>(user, '/api/dashboard');
      const investigations = Array.isArray(data?.investigations) ? data.investigations : [];
      const normalizedData: DashboardData = {
        stats: data?.stats ?? {
          totalFiles: 0,
          suspiciousFiles: 0,
          verifiedLowRiskFiles: 0,
          totalInvestigations: investigations.length,
          modalityCounts: { image: 0, video: 0, audio: 0, text: 0 },
          classificationCounts: {
            Suspicious: 0,
            'No Significant Indicators Detected': 0,
            Inconclusive: 0,
            'Analysis Unavailable': 0,
          },
        },
        investigations,
        recentActivity: Array.isArray(data?.recentActivity) ? data.recentActivity : [],
        evidenceItems: Array.isArray(data?.evidenceItems) ? data.evidenceItems : [],
      };
      setDashboardData(normalizedData);
      if (investigations.length > 0) {
        setActiveInvestigation((prev) => {
          const targetId =
            prev && investigations.some((i) => i.id === prev.id)
              ? prev.id
              : investigations[0].id;
          void loadInvestigation(targetId);
          return prev;
        });
      } else {
        setActiveInvestigation(null);
      }
    } catch (err: any) {
      setWorkspaceError(err?.message || 'Failed to load dashboard.');
    } finally {
      setLoadingDashboard(false);
    }
  }, [user, loadInvestigation]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    apiFetch<{ geminiConfigured: boolean; modalities: Array<{ modality: string }> }>(
      user,
      '/api/models/status'
    )
      .then((res) => {
        if (!mounted) return;
        const total = Array.isArray(res?.modalities) ? res.modalities.length : 4;
        setEngineReadyCount({
          active: res?.geminiConfigured ? total : Math.max(0, total - 1),
          total,
        });
      })
      .catch(() => {
        /* non-blocking */
      });
    return () => {
      mounted = false;
    };
  }, [user]);

  const handleInvestigationCreated = (inv: InvestigationDetail) => {
    setActiveInvestigation(inv);
    setQueuedQuickFiles([]);
    setDashboardData((prev) => {
      if (!prev) return prev;
      const summary = {
        ...inv,
        evidenceCount: inv.evidenceItems.length,
        modalities: Array.from(new Set(inv.evidenceItems.map((e) => e.modality))),
      };
      return {
        ...prev,
        investigations: [summary, ...prev.investigations.filter((i) => i.id !== inv.id)],
      };
    });
    void loadDashboard();
    setActiveTab('case');
  };

  const handleOpenInvestigation = (id: number) => {
    void loadInvestigation(id);
    setActiveTab('case');
  };

  const handleQuickStageFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setQueuedQuickFiles(arr);
    setActiveTab('new');
  };

  const handleExportPdf = async (invOrId: InvestigationDetail | number) => {
    if (!user) return;
    let target: InvestigationDetail | null = null;
    if (typeof invOrId === 'number') {
      const res = await apiFetch<{ investigation: InvestigationDetail }>(
        user,
        `/api/investigations/${invOrId}`
      );
      target = res.investigation;
    } else {
      target = invOrId;
    }
    if (!target) return;
    exportForensicPdfReport(
      target,
      dbUser?.displayName || user?.displayName || 'TruthLens Analyst',
      true
    );
    await apiFetch(user, `/api/investigations/${target.id}/log-export`, {
      method: 'POST',
    }).catch(() => {});
  };

  const handleDeleteInvestigation = async (id: number) => {
    if (!user) return;
    try {
      await apiFetch(user, `/api/investigations/${id}`, { method: 'DELETE' });
      if (activeInvestigation?.id === id) {
        setActiveInvestigation(null);
      }
      await loadDashboard();
    } catch (err: any) {
      setWorkspaceError(err?.message || 'Failed to delete investigation.');
    }
  };

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];
  const displayName = dbUser?.displayName || user?.displayName || 'Forensic Analyst';
  const avatarInitials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || 'TL';

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900 dark:bg-[#0B1120] dark:text-slate-100 transition-colors">
      {/* Left Navigation Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0E1526] lg:flex">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onBackToLanding}
            className="flex items-center gap-2.5 text-left group"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-white shadow-xs group-hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:group-hover:bg-sky-400 transition-colors">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50">
                TRUTHLENS
              </span>
              <span className="block font-mono text-[10px] font-medium uppercase tracking-wider text-blue-700 dark:text-sky-400">
                Digital Forensics
              </span>
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Investigation Rail
          </p>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-50 font-semibold text-blue-700 border border-blue-100 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30'
                      : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active
                        ? 'text-blue-700 dark:text-sky-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Engine Summary & User Account */}
        <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
          {engineReadyCount && (
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:border-slate-300 dark:border-slate-800 dark:bg-[#11192B] dark:hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Forensic Engines
                </span>
                <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-sky-400" />
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
                Analyzers Active: {engineReadyCount.active}/{engineReadyCount.total} Ready
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-blue-700 dark:bg-sky-400"
                  style={{
                    width: `${Math.round(
                      (engineReadyCount.active / Math.max(1, engineReadyCount.total)) * 100
                    )}%`,
                  }}
                />
              </div>
            </button>
          )}

          <div className="flex items-center justify-between gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex min-w-0 items-center gap-2.5">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={displayName}
                  className="h-8 w-8 shrink-0 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 font-mono text-xs font-semibold text-blue-700 border border-blue-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30">
                  {avatarInitials}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {displayName}
                </p>
                <p className="truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  {user?.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Sign Out"
              aria-label="Sign Out"
              className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs dark:bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0E1526]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-700 text-white dark:bg-sky-500 dark:text-slate-950">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  TRUTHLENS
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium ${
                      active
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-sky-500/15 dark:text-sky-300'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">Theme</span>
                <ThemeToggle />
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Utility Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-[#0B1120]/90">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
              <span className="text-slate-400 dark:text-slate-500">TRUTHLENS</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span className="font-semibold text-blue-700 dark:text-sky-400 truncate">
                {currentNav.breadcrumb}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative hidden sm:block w-56 md:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && activeTab !== 'overview') {
                    setActiveTab('overview');
                  }
                }}
                placeholder="Search cases, codes, or descriptions..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#11192B] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500 dark:focus:bg-[#0B1120] transition-colors"
              />
            </div>

            <ThemeToggle />

            {activeTab !== 'new' && (
              <button
                type="button"
                onClick={() => setActiveTab('new')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Investigation</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              title={`${displayName} — Profile & Engine Settings`}
              className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-400 overflow-hidden"
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                avatarInitials
              )}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1360px] flex-1 p-6">
          {workspaceError && (
            <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
              <span>{workspaceError}</span>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="shrink-0 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-400/40 dark:bg-transparent dark:text-rose-100 dark:hover:bg-rose-500/20"
              >
                Retry
              </button>
            </div>
          )}

          {activeTab === 'overview' && (
            <DashboardView
              data={dashboardData}
              loading={loadingDashboard}
              externalSearch={globalSearch}
              onExternalSearchChange={setGlobalSearch}
              onNewInvestigation={() => setActiveTab('new')}
              onQuickDropFiles={handleQuickStageFiles}
              onOpenInvestigation={handleOpenInvestigation}
              onExportInvestigation={(id) => void handleExportPdf(id)}
              onDeleteInvestigation={(id) => void handleDeleteInvestigation(id)}
            />
          )}

          {activeTab === 'new' && (
            <NewInvestigationView
              initialFiles={queuedQuickFiles}
              onConsumedInitialFiles={() => setQueuedQuickFiles([])}
              onSwitchToCompare={() => setActiveTab('compare')}
              onInvestigationCreated={handleInvestigationCreated}
            />
          )}

          {activeTab === 'compare' && (
            <CompareImagesView
              previousImages={(dashboardData?.evidenceItems ?? []).filter(
                (item) => item.modality === 'image'
              )}
            />
          )}

          {activeTab === 'case' && (
            <CaseWorkspaceView
              investigations={dashboardData?.investigations ?? []}
              activeInvestigation={activeInvestigation}
              analystOrg={dbUser?.displayName || user?.displayName || 'TruthLens'}
              includeLimitations={dbUser?.includeLimitationsInExports ?? true}
              onSelectInvestigation={(id) => void loadInvestigation(id)}
              onInvestigationUpdated={(inv) => {
                setActiveInvestigation(inv);
                void loadDashboard();
              }}
              onDownloadPdf={(inv) => void handleExportPdf(inv)}
              onNewInvestigation={() => setActiveTab('new')}
            />
          )}

          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}
