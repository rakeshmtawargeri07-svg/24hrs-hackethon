import { Check, Cpu, Loader2, Moon, Sun } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { apiFetch } from '../../lib/api';

interface ModalityEngineStatus {
  modality: 'image' | 'video' | 'text' | 'audio';
  activeContentPipeline: string[];
  optionalProvenancePipeline: string[];
  localTrainedWeights: {
    expectedModels: string[];
    weightsPresent: boolean;
    status: string;
  };
  benchmarkDatasets: {
    expectedDatasets: string[];
    datasetsPresent: boolean;
    status: string;
  };
}

interface DetectionSystemStatus {
  geminiConfigured: boolean;
  ffmpegAvailable: boolean;
  modalities: ModalityEngineStatus[];
}

export function SettingsView() {
  const { user, dbUser, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [displayName, setDisplayName] = useState(dbUser?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<DetectionSystemStatus | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    apiFetch<DetectionSystemStatus>(user, '/api/models/status')
      .then((res) => {
        if (active) setModelStatus(res);
      })
      .catch(() => {
        /* non-blocking status read */
      });
    return () => {
      active = false;
    };
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSavedBanner(false);
    setErrorMsg(null);
    try {
      await apiFetch(user, '/api/me/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          includeLimitationsInExports: true,
        }),
      });
      await refreshProfile();
      setSavedBanner(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
          Workspace Configuration
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Engine &amp; Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your analyst profile, interface theme, and active forensic detection pipelines.
        </p>
      </div>

      {/* Appearance Theme Switcher */}
      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Appearance</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Choose between the crisp light clinical canvas or dark forensic mode across the entire app.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold transition-colors ${
              theme === 'light'
                ? 'border-blue-600 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Sun className="h-4 w-4 text-amber-500" />
            <span>Light Mode</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold transition-colors ${
              theme === 'dark'
                ? 'border-sky-400 bg-sky-500/15 text-sky-300'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Moon className="h-4 w-4 text-blue-700 dark:text-sky-400" />
            <span>Dark Mode</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="max-w-xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Analyst Profile
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Your name appears in your workspace and on exported certified PDF reports.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email Address
            </label>
            <input
              type="text"
              disabled
              value={dbUser?.email || user?.email || ''}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#0B1120]/60 dark:text-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500"
            />
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
              {errorMsg}
            </div>
          )}

          {savedBanner && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <Check className="h-4 w-4" />
              <span>Profile saved.</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Save Profile</span>
          </button>
        </div>
      </form>

      {modelStatus && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                <Cpu className="h-4 w-4 text-blue-700 dark:text-sky-400" />
                <span>Detection Engines &amp; Model Status</span>
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Content-based signal analyzers run primary detection; EXIF, C2PA, and watermarks are checked as advisory context only.
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-300">
                FFmpeg: {modelStatus.ffmpegAvailable ? 'Ready' : 'Browser fallback'}
              </span>
              <span
                className={`rounded-md border px-2.5 py-1 ${
                  modelStatus.geminiConfigured
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                }`}
              >
                Multimodal AI: {modelStatus.geminiConfigured ? 'Ready' : 'Unavailable'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {modelStatus.modalities.map((m) => (
              <div
                key={m.modality}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-[#0B1120] space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold uppercase tracking-wider text-blue-700 dark:text-sky-400">
                    {m.modality}
                  </span>
                  <span
                    className={`font-mono text-[11px] font-medium ${
                      m.localTrainedWeights.weightsPresent
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {m.localTrainedWeights.weightsPresent
                      ? 'Local Weights Mounted'
                      : 'Signal + AI Active'}
                  </span>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Active Content Checks
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                    {m.activeContentPipeline.map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-slate-200 pt-2 text-[11px] text-slate-500 dark:border-slate-800/80">
                  <p>
                    <span className="font-medium text-slate-700 dark:text-slate-400">
                      External Weights ({m.localTrainedWeights.expectedModels.join(', ')}):{' '}
                    </span>
                    {m.localTrainedWeights.status}
                  </p>
                  <p className="mt-0.5">
                    <span className="font-medium text-slate-700 dark:text-slate-400">
                      Eval Datasets ({m.benchmarkDatasets.expectedDatasets.join(', ')}):{' '}
                    </span>
                    {m.benchmarkDatasets.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
