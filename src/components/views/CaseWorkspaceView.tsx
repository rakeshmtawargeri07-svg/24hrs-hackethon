import {
  AudioLines,
  Check,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Film,
  GitCompareArrows,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../lib/api';
import {
  EvidenceModality,
  InvestigationDetail,
  InvestigationSummary,
} from '../../types/forensics';
import { ClassificationBadge } from '../ForensicBadges';
import { AudioForensicsView } from './AudioForensicsView';
import { ImageForensicsView } from './ImageForensicsView';
import { TextAnalysisView } from './TextAnalysisView';
import { VideoForensicsView } from './VideoForensicsView';

const PAIR_LABELS: Record<string, string> = {
  audio_video_sync: 'Audio & Video Timing',
  lip_speech_consistency: 'Lip & Voice Match',
  video_transcript: 'Video & Text Match',
  image_video_similarity: 'Photo & Video Match',
  cross_source_contradiction: 'Conflicting Details',
};

function iconFor(modality: EvidenceModality) {
  if (modality === 'image') return ImageIcon;
  if (modality === 'video') return Film;
  if (modality === 'audio') return AudioLines;
  return FileText;
}

function cleanReportText(text: string): string {
  if (!text) return '';
  return text
    .replace(
      /\(metadataStripped:\s*true,\s*hasCameraHardwareTags:\s*false\)/gi,
      '(camera details missing)'
    )
    .replace(/\bmetadataStripped:\s*true\b/gi, 'camera details missing')
    .replace(/\bhasCameraHardwareTags:\s*false\b/gi, 'no camera info')
    .replace(/,\s*modality:\s*(image|video|audio|text)/gi, ' ($1)')
    .replace(/\s*\(ELA mean delta [^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortFingerprint(hash: string): string {
  if (!hash || hash.length <= 18) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

export function CaseWorkspaceView({
  investigations,
  activeInvestigation,
  analystOrg,
  includeLimitations,
  onSelectInvestigation,
  onInvestigationUpdated,
  onDownloadPdf,
  onNewInvestigation,
}: {
  investigations: InvestigationSummary[];
  activeInvestigation: InvestigationDetail | null;
  analystOrg: string;
  includeLimitations: boolean;
  onSelectInvestigation: (id: number) => void;
  onInvestigationUpdated: (inv: InvestigationDetail) => void;
  onDownloadPdf: (inv: InvestigationDetail) => void;
  onNewInvestigation: () => void;
}) {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<'summary' | 'evidence' | 'report'>('evidence');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<number | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedHashId, setCopiedHashId] = useState<number | null>(null);

  const handleCopyHash = (id: number, hash: string) => {
    void navigator.clipboard?.writeText(hash);
    setCopiedHashId(id);
    setTimeout(() => setCopiedHashId((cur) => (cur === id ? null : cur)), 1800);
  };

  useEffect(() => {
    if (activeInvestigation && activeInvestigation.evidenceItems.length > 0) {
      if (!activeInvestigation.evidenceItems.some((e) => e.id === selectedEvidenceId)) {
        setSelectedEvidenceId(activeInvestigation.evidenceItems[0].id);
      }
    } else {
      setSelectedEvidenceId(null);
    }
  }, [activeInvestigation, selectedEvidenceId]);

  if (investigations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-14 text-center dark:border-slate-700 dark:bg-[#11192B]">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          No active case selected
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Start a new investigation to inspect photos, videos, audio clips, and documents together.
        </p>
        <button
          type="button"
          onClick={onNewInvestigation}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
        >
          <FilePlus2 className="h-4 w-4" />
          <span>New Investigation</span>
        </button>
      </div>
    );
  }

  const handleRerunCorrelation = async () => {
    if (!user || !activeInvestigation) return;
    setRerunning(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ investigation: InvestigationDetail }>(
        user,
        `/api/investigations/${activeInvestigation.id}/correlate`,
        { method: 'POST' }
      );
      onInvestigationUpdated(res.investigation);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to refresh comparison.');
    } finally {
      setRerunning(false);
    }
  };

  const selectedEvidence =
    activeInvestigation?.evidenceItems.find((e) => e.id === selectedEvidenceId) ??
    activeInvestigation?.evidenceItems[0] ??
    null;

  return (
    <div className="space-y-5">
      {/* Case Header & Control Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Case ID:
            </span>
            <select
              value={activeInvestigation?.id ?? investigations[0].id}
              onChange={(e) => onSelectInvestigation(Number(e.target.value))}
              className="max-w-md rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500"
            >
              {investigations.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.caseCode} — {inv.title}
                </option>
              ))}
            </select>

            {activeInvestigation && (
              <ClassificationBadge
                classification={activeInvestigation.overallAssessment}
                confidence={activeInvestigation.overallConfidence}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-[#0B1120]">
              {(
                [
                  { id: 'evidence', label: 'Inspect Files' },
                  { id: 'summary', label: 'Compare & Summary' },
                  { id: 'report', label: 'Full Report' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    subTab === tab.id
                      ? 'bg-blue-700 text-white shadow-2xs dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeInvestigation && (
              <button
                type="button"
                onClick={() => onDownloadPdf(activeInvestigation)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:hover:border-sky-500 dark:hover:bg-sky-500/10 dark:hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400" />
                <span>Export Certified PDF</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected Evidence Metadata Bar + File Switcher */}
        {activeInvestigation && activeInvestigation.evidenceItems.length > 0 && (
          <div className="border-t border-slate-100 pt-3.5 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {activeInvestigation.evidenceItems.map((item) => {
                const Icon = iconFor(item.modality);
                const isSelected = selectedEvidence?.id === item.id;
                const aiProb =
                  typeof item.metadataJson?.aiProbability === 'number'
                    ? item.metadataJson.aiProbability
                    : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedEvidenceId(item.id);
                      if (subTab !== 'evidence') setSubTab('evidence');
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50 text-blue-800 font-semibold dark:border-sky-400 dark:bg-sky-500/15 dark:text-sky-200'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-[#0B1120] dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isSelected
                          ? 'text-blue-700 dark:text-sky-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    />
                    <span className="max-w-[180px] truncate">{item.filename}</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        isSelected
                          ? 'text-blue-700 dark:text-sky-300'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {aiProb !== null ? `AI ${aiProb}%` : `${item.confidence}%`}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedEvidence && subTab === 'evidence' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] font-mono text-slate-600 dark:border-slate-800 dark:bg-[#0B1120] dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    FILE:{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {selectedEvidence.filename}
                    </strong>
                  </span>
                  <span>
                    SIZE:{' '}
                    <strong className="tabular-nums text-slate-900 dark:text-slate-100">
                      {selectedEvidence.fileSize >= 1024 * 1024
                        ? `${(selectedEvidence.fileSize / (1024 * 1024)).toFixed(2)} MB`
                        : `${(selectedEvidence.fileSize / 1024).toFixed(1)} KB`}
                    </strong>
                  </span>
                  <span>
                    MODALITY:{' '}
                    <strong className="uppercase text-slate-900 dark:text-slate-100">
                      {selectedEvidence.modality}
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyHash(selectedEvidence.id, selectedEvidence.sha256Hash)}
                  title={`Copy full SHA-256: ${selectedEvidence.sha256Hash}`}
                  className="inline-flex items-center gap-1.5 text-blue-700 hover:text-blue-600 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  <span>SHA-256: {shortFingerprint(selectedEvidence.sha256Hash)}</span>
                  {copiedHashId === selectedEvidence.id ? (
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {errorMsg}
        </div>
      )}

      {!activeInvestigation ? (
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#11192B]" />
      ) : subTab === 'evidence' ? (
        <div className="space-y-5">
          {selectedEvidence && selectedEvidence.modality === 'image' && (
            <ImageForensicsView
              images={[selectedEvidence]}
              onGoToUpload={onNewInvestigation}
            />
          )}
          {selectedEvidence && selectedEvidence.modality === 'video' && (
            <VideoForensicsView
              videos={[selectedEvidence]}
              onGoToUpload={onNewInvestigation}
            />
          )}
          {selectedEvidence && selectedEvidence.modality === 'audio' && (
            <AudioForensicsView
              audios={[selectedEvidence]}
              onGoToUpload={onNewInvestigation}
            />
          )}
          {selectedEvidence && selectedEvidence.modality === 'text' && (
            <TextAnalysisView
              textItems={[selectedEvidence]}
              onGoToUpload={onNewInvestigation}
            />
          )}
          {!selectedEvidence && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-[#11192B]">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                No completed file results for this case yet
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {activeInvestigation.summary || 'This check did not finish saving file results.'}
              </p>
              <button
                type="button"
                onClick={onNewInvestigation}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span>Run New Check</span>
              </button>
            </div>
          )}
        </div>
      ) : subTab === 'summary' ? (
        <div className="space-y-5">
          {/* Executive Assessment */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Overall Summary &amp; Analytical Limits
              </h2>
              <button
                type="button"
                onClick={handleRerunCorrelation}
                disabled={rerunning}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-60 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200 dark:hover:border-sky-500 dark:hover:bg-sky-500/10 dark:hover:text-sky-300 transition-colors"
              >
                {rerunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700 dark:text-sky-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400" />
                )}
                <span>Re-check Consistency</span>
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {cleanReportText(activeInvestigation.summary)}
            </p>

            <div className="mt-5 grid grid-cols-1 gap-5 border-t border-slate-100 pt-4 dark:border-slate-800 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  What This Check Cannot Prove
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {cleanReportText(activeInvestigation.limitations)}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Suggested Next Steps
                </h3>
                <ul className="mt-1.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                  {activeInvestigation.recommendations.slice(0, 3).map((rec, idx) => (
                    <li key={idx}>• {cleanReportText(rec)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Cross-Modal Correlations */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <GitCompareArrows className="h-4 w-4 text-blue-700 dark:text-sky-400" />
              Cross-Check Across Files
            </h2>
            {activeInvestigation.correlations.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Add 2 or more related files in one check to compare timing, lip-speech match, and details across files.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {activeInvestigation.correlations.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-[#0B1120]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
                          {PAIR_LABELS[c.pairType] || c.pairType}
                        </p>
                        <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {c.title}
                        </h3>
                      </div>
                      <ClassificationBadge
                        classification={c.consistencyStatus}
                        confidence={c.confidence}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      {c.findingSummary}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      Files compared: {c.sourceEvidenceIds.map((id) => `#${id}`).join(', ')} ·{' '}
                      {c.limitations}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Full Report View */
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
                  Case Report · {analystOrg}
                </p>
                <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-50">
                  {activeInvestigation.caseCode}: {activeInvestigation.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onDownloadPdf(activeInvestigation)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>Download PDF Report</span>
              </button>
            </div>

            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Executive Summary
                </h3>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  Overall Confidence: {activeInvestigation.overallConfidence}%
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {cleanReportText(activeInvestigation.summary)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Files Checked ({activeInvestigation.evidenceItems.length})
              </h3>
              <div className="mt-3 space-y-2.5">
                {activeInvestigation.evidenceItems.map((item) => {
                  const Icon = iconFor(item.modality);
                  const detectionLabel =
                    typeof item.metadataJson?.detectionLabel === 'string'
                      ? item.metadataJson.detectionLabel
                      : undefined;
                  const aiProb =
                    typeof item.metadataJson?.aiProbability === 'number'
                      ? item.metadataJson.aiProbability
                      : null;
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-[#0B1120]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="h-4 w-4 shrink-0 text-blue-700 dark:text-sky-400" />
                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {item.filename}
                          </span>
                        </div>
                        <ClassificationBadge
                          classification={item.classification}
                          confidence={item.confidence}
                          detectionLabel={detectionLabel}
                        />
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="capitalize">
                          {item.modality}
                          {aiProb !== null ? ` · AI Prob ${aiProb}%` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyHash(item.id, item.sha256Hash)}
                          title={`Copy full SHA-256: ${item.sha256Hash}`}
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-sky-400 transition-colors"
                        >
                          <span>SHA: {shortFingerprint(item.sha256Hash)}</span>
                          {copiedHashId === item.id ? (
                            <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Key Findings</h3>
              <div className="mt-3 space-y-2">
                {activeInvestigation.evidenceItems.every((i) => i.findings.length === 0) &&
                activeInvestigation.correlations.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No unusual issues recorded.
                  </p>
                ) : (
                  <>
                    {activeInvestigation.evidenceItems.flatMap((i) =>
                      i.findings.map((f) => (
                        <div
                          key={f.id}
                          className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-[#0B1120]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {f.whatDetected}
                            </p>
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                              {f.confidence}%
                            </span>
                          </div>
                          <p className="mt-1 text-slate-500 dark:text-slate-400">
                            {i.filename} · {f.whereDetected}
                          </p>
                        </div>
                      ))
                    )}
                    {activeInvestigation.correlations.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-[#0B1120]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {c.title}
                          </p>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            {c.confidence}%
                          </span>
                        </div>
                        <p className="mt-1 text-slate-500 dark:text-slate-400">
                          {c.consistencyStatus}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                What This Check Cannot Prove
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {includeLimitations
                  ? cleanReportText(activeInvestigation.limitations)
                  : 'Detailed limits hidden per report settings.'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Suggested Next Steps
              </h3>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {activeInvestigation.recommendations.slice(0, 4).map((r, idx) => (
                  <li key={idx}>• {cleanReportText(r)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
