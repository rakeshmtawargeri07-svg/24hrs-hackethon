import { Check, Cpu, Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
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
    <div className="max-w-3xl space-y-6">
      <form onSubmit={handleSave} className="max-w-xl space-y-6">
        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Your Profile</h3>
            <p className="mt-1 text-xs text-slate-400">
              Your name appears in your workspace and on downloaded PDF reports.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Your Email</label>
            <input
              type="text"
              disabled
              value={dbUser?.email || user?.email || ''}
              className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#0B1120]/60 px-3.5 py-2 text-sm text-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Your Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {savedBanner && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <Check className="h-4 w-4" />
              <span>Profile saved.</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Save Profile</span>
          </button>
        </div>
      </form>

      {modelStatus && (
        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
                <Cpu className="h-4 w-4 text-sky-400" />
                <span>Detection Engines &amp; Model Status</span>
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Content-based signal analyzers run primary detection; EXIF, C2PA, and watermarks are checked as optional signals only.
              </p>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
              <span>FFmpeg: {modelStatus.ffmpegAvailable ? 'Ready' : 'Browser fallback'}</span>
              <span>Vision/Audio AI: {modelStatus.geminiConfigured ? 'Ready' : 'Unavailable'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {modelStatus.modalities.map((m) => (
              <div
                key={m.modality}
                className="rounded-lg border border-slate-800 bg-[#0B1120] p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold uppercase tracking-wide text-sky-400">
                    {m.modality}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      m.localTrainedWeights.weightsPresent ? 'text-emerald-300' : 'text-slate-400'
                    }`}
                  >
                    {m.localTrainedWeights.weightsPresent ? 'Local Weights Mounted' : 'Signal + AI Active'}
                  </span>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-300">Active Content Checks</p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                    {m.activeContentPipeline.map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-slate-800/80 pt-2 text-[11px] text-slate-500">
                  <p>
                    <span className="text-slate-400">External Weights ({m.localTrainedWeights.expectedModels.join(', ')}): </span>
                    {m.localTrainedWeights.status}
                  </p>
                  <p className="mt-0.5">
                    <span className="text-slate-400">Eval Datasets ({m.benchmarkDatasets.expectedDatasets.join(', ')}): </span>
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

