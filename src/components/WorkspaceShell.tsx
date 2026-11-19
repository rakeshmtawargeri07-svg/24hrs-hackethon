import {
  Columns2,
  FilePlus2,
  FolderSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { exportForensicPdfReport } from '../lib/pdfReport';
import { DashboardData, InvestigationDetail } from '../types/forensics';
import { CaseWorkspaceView } from './views/CaseWorkspaceView';
import { CompareImagesView } from './views/CompareImagesView';
import { DashboardView } from './views/DashboardView';
import { NewInvestigationView } from './views/NewInvestigationView';
import { SettingsView } from './views/SettingsView';

type SimpleTab = 'overview' | 'new' | 'compare' | 'case' | 'settings';

const NAV_ITEMS: Array<{
  id: SimpleTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: 'Home', icon: LayoutDashboard },
  { id: 'new', label: 'New Check', icon: FilePlus2 },
  { id: 'compare', label: 'Compare Photos', icon: Columns2 },
  { id: 'case', label: 'Case Results', icon: FolderSearch },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function WorkspaceShell({ onBackToLanding }: { onBackToLanding: () => void }) {
  const { user, dbUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<SimpleTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [activeInvestigation, setActiveInvestigation] = useState<InvestigationDetail | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

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

  const handleInvestigationCreated = (inv: InvestigationDetail) => {
    setActiveInvestigation(inv);
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
      dbUser?.displayName || user?.displayName || 'TruthLens',
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

  const currentLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Overview';

  return (
    <div className="flex min-h-screen bg-[#0B1120] text-[#F8FAFC]">
      {/* Slim 224px Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-800 bg-[#0E1526] lg:flex">
        <div className="border-b border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onBackToLanding}
            className="text-lg font-bold tracking-tight text-slate-50 hover:text-sky-400 transition-colors"
          >
            TruthLens
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
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <p className="truncate text-xs font-medium text-slate-200">
            {dbUser?.displayName || user?.displayName || 'Analyst'}
          </p>
          <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-60 flex-col border-r border-slate-800 bg-[#0E1526]">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <span className="text-lg font-bold text-slate-50">TruthLens</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-100"
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
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-800 bg-[#0B1120]/90 px-6 py-3.5 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-800 p-2 text-slate-300 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="truncate text-sm font-semibold text-slate-100">{currentLabel}</h1>
          </div>

          {activeTab !== 'new' && (
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              <span>New Check</span>
            </button>
          )}
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 p-6">
          {workspaceError && (
            <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <span>{workspaceError}</span>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="shrink-0 rounded border border-rose-400/40 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-500/20"
              >
                Retry
              </button>
            </div>
          )}

          {activeTab === 'overview' && (
            <DashboardView
              data={dashboardData}
              loading={loadingDashboard}
              onNewInvestigation={() => setActiveTab('new')}
              onOpenInvestigation={handleOpenInvestigation}
              onExportInvestigation={(id) => void handleExportPdf(id)}
              onDeleteInvestigation={(id) => void handleDeleteInvestigation(id)}
            />
          )}

          {activeTab === 'new' && (
            <NewInvestigationView onInvestigationCreated={handleInvestigationCreated} />
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
              includeLimitations={true}
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
