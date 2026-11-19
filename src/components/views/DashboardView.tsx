import {
  Activity,
  AlertTriangle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Film,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '../../context/ThemeContext';
import {
  DashboardData,
  EvidenceItem,
  EvidenceModality,
  ForensicClassification,
  InvestigationSummary,
} from '../../types/forensics';
import { ClassificationBadge } from '../ForensicBadges';

type TimeWindow = '24H' | '7D' | '30D' | 'ALL';

const FILTER_OPTIONS: Array<{ value: 'All' | ForensicClassification; label: string }> = [
  { value: 'All', label: 'All Cases' },
  { value: 'Suspicious', label: 'Suspicious' },
  { value: 'No Significant Indicators Detected', label: 'Looks Normal' },
  { value: 'Inconclusive', label: 'Inconclusive' },
];

const MODALITY_COLORS: Record<EvidenceModality, string> = {
  image: '#1D4ED8',
  video: '#3B82F6',
  audio: '#60A5FA',
  text: '#93C5FD',
};

const PAGE_SIZE = 6;

function modalityIcon(m: EvidenceModality) {
  if (m === 'image') return ImageIcon;
  if (m === 'video') return Film;
  if (m === 'audio') return AudioLines;
  return FileText;
}

function downloadAuditCsv(investigations: InvestigationSummary[]) {
  const headers = [
    'Case Code',
    'Title',
    'Overall Assessment',
    'Confidence (%)',
    'Files Checked',
    'Modalities',
    'Created At',
  ];
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = investigations.map((inv) =>
    [
      inv.caseCode,
      inv.title,
      inv.overallAssessment,
      inv.overallConfidence,
      inv.evidenceCount,
      Array.isArray(inv.modalities) ? inv.modalities.join(' | ') : '',
      new Date(inv.createdAt).toISOString(),
    ]
      .map(escape)
      .join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `truthlens-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DashboardView({
  data,
  loading,
  externalSearch = '',
  onExternalSearchChange,
  onNewInvestigation,
  onQuickDropFiles,
  onOpenInvestigation,
  onExportInvestigation,
  onDeleteInvestigation,
}: {
  data: DashboardData | null;
  loading: boolean;
  externalSearch?: string;
  onExternalSearchChange?: (val: string) => void;
  onNewInvestigation: () => void;
  onQuickDropFiles: (files: FileList | File[]) => void;
  onOpenInvestigation: (id: number) => void;
  onExportInvestigation: (id: number) => void;
  onDeleteInvestigation: (id: number) => void;
}) {
  const { theme } = useTheme();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('ALL');
  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ForensicClassification>('All');
  const [page, setPage] = useState(1);
  const [dragActive, setDragActive] = useState(false);
  const [spotlightId, setSpotlightId] = useState<number | null>(null);

  const searchQuery = externalSearch || localSearch;

  const handleSearchInput = (val: string) => {
    setLocalSearch(val);
    setPage(1);
    if (onExternalSearchChange) onExternalSearchChange(val);
  };

  const allInvestigations = data?.investigations ?? [];
  const allEvidence = data?.evidenceItems ?? [];

  const timeCutoffMs = useMemo(() => {
    const now = Date.now();
    if (timeWindow === '24H') return now - 24 * 60 * 60 * 1000;
    if (timeWindow === '7D') return now - 7 * 24 * 60 * 60 * 1000;
    if (timeWindow === '30D') return now - 30 * 24 * 60 * 60 * 1000;
    return 0;
  }, [timeWindow]);

  const timeFilteredInvestigations = useMemo(() => {
    if (timeCutoffMs === 0) return allInvestigations;
    return allInvestigations.filter((inv) => new Date(inv.createdAt).getTime() >= timeCutoffMs);
  }, [allInvestigations, timeCutoffMs]);

  const timeFilteredInvIds = useMemo(
    () => new Set(timeFilteredInvestigations.map((i) => i.id)),
    [timeFilteredInvestigations]
  );

  const timeFilteredEvidence = useMemo(() => {
    if (timeCutoffMs === 0) return allEvidence;
    return allEvidence.filter((e) => timeFilteredInvIds.has(e.investigationId));
  }, [allEvidence, timeCutoffMs, timeFilteredInvIds]);

  const computedStats = useMemo(() => {
    if (timeWindow === 'ALL' && data?.stats) {
      return {
        totalFiles: data.stats.totalFiles,
        suspiciousFiles: data.stats.suspiciousFiles,
        verifiedLowRiskFiles: data.stats.verifiedLowRiskFiles,
        inconclusiveFiles: data.stats.classificationCounts.Inconclusive ?? 0,
        unavailableFiles: data.stats.classificationCounts['Analysis Unavailable'] ?? 0,
        totalInvestigations: data.stats.totalInvestigations,
        modalityCounts: data.stats.modalityCounts,
      };
    }
    const modalityCounts: Record<EvidenceModality, number> = {
      image: 0,
      video: 0,
      audio: 0,
      text: 0,
    };
    let suspiciousFiles = 0;
    let verifiedLowRiskFiles = 0;
    let inconclusiveFiles = 0;
    let unavailableFiles = 0;
    for (const item of timeFilteredEvidence) {
      if (item.modality in modalityCounts) {
        modalityCounts[item.modality] += 1;
      }
      if (item.classification === 'Suspicious') suspiciousFiles += 1;
      else if (item.classification === 'No Significant Indicators Detected')
        verifiedLowRiskFiles += 1;
      else if (item.classification === 'Inconclusive') inconclusiveFiles += 1;
      else if (item.classification === 'Analysis Unavailable') unavailableFiles += 1;
    }
    return {
      totalFiles: timeFilteredEvidence.length,
      suspiciousFiles,
      verifiedLowRiskFiles,
      inconclusiveFiles,
      unavailableFiles,
      totalInvestigations: timeFilteredInvestigations.length,
      modalityCounts,
    };
  }, [timeWindow, data?.stats, timeFilteredEvidence, timeFilteredInvestigations.length]);

  const filteredInvestigations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return timeFilteredInvestigations.filter((inv) => {
      const matchesStatus =
        statusFilter === 'All' || inv.overallAssessment === statusFilter;
      const matchesQuery =
        !q ||
        inv.title.toLowerCase().includes(q) ||
        inv.caseCode.toLowerCase().includes(q) ||
        inv.description.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [timeFilteredInvestigations, statusFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts = {
      All: timeFilteredInvestigations.length,
      Suspicious: 0,
      'No Significant Indicators Detected': 0,
      Inconclusive: 0,
      'Analysis Unavailable': 0,
    };
    for (const inv of timeFilteredInvestigations) {
      if (inv.overallAssessment in counts) {
        counts[inv.overallAssessment] += 1;
      }
    }
    return counts;
  }, [timeFilteredInvestigations]);

  const totalPages = Math.max(1, Math.ceil(filteredInvestigations.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedInvestigations = filteredInvestigations.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const evidenceByInvId = useMemo(() => {
    const map = new Map<number, EvidenceItem[]>();
    for (const item of allEvidence) {
      const arr = map.get(item.investigationId) ?? [];
      arr.push(item);
      map.set(item.investigationId, arr);
    }
    return map;
  }, [allEvidence]);

  const spotlightInv =
    filteredInvestigations.find((i) => i.id === spotlightId) ??
    filteredInvestigations[0] ??
    timeFilteredInvestigations[0] ??
    null;

  const spotlightItems = spotlightInv ? evidenceByInvId.get(spotlightInv.id) ?? [] : [];
  const spotlightImage = spotlightItems.find((i) => i.modality === 'image') ?? null;

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#11192B]"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#11192B]"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#11192B]" />
      </div>
    );
  }

  const totalModalities =
    computedStats.modalityCounts.image +
    computedStats.modalityCounts.video +
    computedStats.modalityCounts.audio +
    computedStats.modalityCounts.text;

  const modalityBreakdown: Array<{
    key: EvidenceModality;
    label: string;
    count: number;
    pct: number;
    color: string;
  }> = [
    {
      key: 'image',
      label: 'Images',
      count: computedStats.modalityCounts.image,
      pct:
        totalModalities > 0
          ? Math.round((computedStats.modalityCounts.image / totalModalities) * 100)
          : 0,
      color: MODALITY_COLORS.image,
    },
    {
      key: 'video',
      label: 'Videos',
      count: computedStats.modalityCounts.video,
      pct:
        totalModalities > 0
          ? Math.round((computedStats.modalityCounts.video / totalModalities) * 100)
          : 0,
      color: MODALITY_COLORS.video,
    },
    {
      key: 'audio',
      label: 'Audio / Voice',
      count: computedStats.modalityCounts.audio,
      pct:
        totalModalities > 0
          ? Math.round((computedStats.modalityCounts.audio / totalModalities) * 100)
          : 0,
      color: MODALITY_COLORS.audio,
    },
    {
      key: 'text',
      label: 'Text / Doc',
      count: computedStats.modalityCounts.text,
      pct:
        totalModalities > 0
          ? Math.round((computedStats.modalityCounts.text / totalModalities) * 100)
          : 0,
      color: MODALITY_COLORS.text,
    },
  ];

  const nonZeroChartData = modalityBreakdown.filter((m) => m.count > 0);
  const topModality = [...modalityBreakdown].sort((a, b) => b.count - a.count)[0];

  const threatRate =
    computedStats.totalFiles > 0
      ? ((computedStats.suspiciousFiles / computedStats.totalFiles) * 100).toFixed(1)
      : '0.0';
  const authRate =
    computedStats.totalFiles > 0
      ? ((computedStats.verifiedLowRiskFiles / computedStats.totalFiles) * 100).toFixed(1)
      : '0.0';

  const suspiciousByModality = (['image', 'video', 'audio', 'text'] as EvidenceModality[]).map(
    (mod) => {
      const items = timeFilteredEvidence.filter((e) => e.modality === mod);
      const susp = items.filter((e) => e.classification === 'Suspicious').length;
      return {
        mod,
        label:
          mod === 'image'
            ? 'Image Spectral & ELA Flags'
            : mod === 'video'
            ? 'Video Temporal & Frame Flags'
            : mod === 'audio'
            ? 'Audio Acoustic & Voice Flags'
            : 'Text & Stylometry Flags',
        total: items.length,
        suspicious: susp,
        pct:
          computedStats.suspiciousFiles > 0
            ? Math.round((susp / computedStats.suspiciousFiles) * 100)
            : 0,
      };
    }
  );

  const tooltipStyle =
    theme === 'dark'
      ? {
          backgroundColor: '#0F172A',
          borderColor: '#334155',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#F8FAFC',
        }
      : {
          backgroundColor: '#FFFFFF',
          borderColor: '#E2E8F0',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#0F172A',
        };

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
            Forensic Operations
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Forensic Operations Intelligence
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Evidence verification telemetry, modality distribution, and tamper audit logs across active cases.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            {(['24H', '7D', '30D', 'ALL'] as TimeWindow[]).map((win) => (
              <button
                key={win}
                type="button"
                onClick={() => {
                  setTimeWindow(win);
                  setPage(1);
                }}
                className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                  timeWindow === win
                    ? 'bg-blue-700 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                {win === 'ALL' ? 'All' : win}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={filteredInvestigations.length === 0}
            onClick={() => downloadAuditCsv(filteredInvestigations)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#11192B] dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <span>Export Audit Log</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Files Checked
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
            {computedStats.totalFiles}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
              {computedStats.totalInvestigations}
            </span>{' '}
            {computedStats.totalInvestigations === 1 ? 'case' : 'cases'} in window
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Suspicious / AI Gen
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="font-mono text-3xl font-bold tabular-nums text-rose-700 dark:text-rose-400">
              {computedStats.suspiciousFiles}
            </p>
            <span className="font-mono text-xs font-medium tabular-nums text-rose-600 dark:text-rose-300">
              {threatRate}% Flag Rate
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Requires forensic review &amp; verification
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Verified Normal
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {computedStats.verifiedLowRiskFiles}
            </p>
            <span className="font-mono text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
              {authRate}% Clear
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            No significant manipulation indicators
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Inconclusive / Review
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <HelpCircle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {computedStats.inconclusiveFiles}
            </p>
            {computedStats.unavailableFiles > 0 && (
              <span className="font-mono text-xs tabular-nums text-amber-700 dark:text-amber-300">
                +{computedStats.unavailableFiles} unparsed
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Borderline signals or short excerpts
          </p>
        </div>
      </div>

      {/* Empty State or 3-Column Bento Analytics + Quick Dropzone */}
      {allInvestigations.length === 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-[#11192B] lg:col-span-7 flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Welcome to TruthLens
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Upload photos, videos, audio clips, or documents into a single forensic case to run 2D-FFT frequency checks, error level analysis, voice screening, and cross-modal comparison.
              </p>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-[#0B1120]">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Photo &amp; ELA Inspector
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  2D-FFT spectrum, Laplacian noise residual, and edit heatmap overlay.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-[#0B1120]">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Video &amp; Voice Screening
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Keyframe temporal consistency, STFT waveform, and AI speech signals.
                </p>
              </div>
            </div>
            <div className="mt-6">
              <button
                type="button"
                onClick={onNewInvestigation}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
              >
                <FilePlus2 className="h-4 w-4" />
                <span>Start New Investigation</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#11192B] lg:col-span-5 flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Quick Forensic Dropzone
              </h3>
              <span className="font-mono text-[11px] font-semibold uppercase text-blue-700 dark:text-sky-400">
                Multi-Modal
              </span>
            </div>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files?.length) onQuickDropFiles(e.dataTransfer.files);
              }}
              className={`mt-4 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                dragActive
                  ? 'border-blue-600 bg-blue-50/70 dark:border-sky-400 dark:bg-sky-500/10'
                  : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-500/60'
              }`}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                <UploadCloud className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Drop evidence files to begin
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                JPG, PNG, MP4, MOV, MP3, WAV, PDF, DOCX
              </p>
              <span className="mt-4 inline-flex items-center rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white dark:bg-sky-500 dark:text-slate-950">
                Select Evidence File
              </span>
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.avi,.mp3,.wav,.m4a,.txt,.pdf,.docx"
                onChange={(e) => {
                  if (e.target.files?.length) onQuickDropFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          </div>
        </div>
      ) : (
        <>
          {/* Middle 3-Column Bento Grid */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* 1. Analyzed Modalities Donut */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Analyzed Modalities
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Multi-vector evidence distribution
                  </p>
                </div>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {totalModalities} Assets
                </span>
              </div>

              <div className="relative mx-auto my-2 h-44 w-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={
                        nonZeroChartData.length > 0
                          ? nonZeroChartData
                          : [
                              {
                                key: 'empty',
                                label: 'No files',
                                count: 1,
                                color: theme === 'dark' ? '#1E293B' : '#E2E8F0',
                              },
                            ]
                      }
                      dataKey="count"
                      nameKey="label"
                      innerRadius={52}
                      outerRadius={72}
                      paddingAngle={nonZeroChartData.length > 1 ? 3 : 0}
                      stroke="none"
                    >
                      {(nonZeroChartData.length > 0
                        ? nonZeroChartData
                        : [
                            {
                              key: 'empty',
                              color: theme === 'dark' ? '#1E293B' : '#E2E8F0',
                            },
                          ]
                      ).map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    {nonZeroChartData.length > 0 && <Tooltip contentStyle={tooltipStyle} />}
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                    {totalModalities > 0 ? `${topModality.pct}%` : '0%'}
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {totalModalities > 0 ? topModality.label : 'No Data'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {modalityBreakdown.map((m) => (
                  <div
                    key={m.key}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-[#0B1120]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: m.color }}
                      />
                      <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                        {m.label}: <span className="font-mono tabular-nums">{m.count}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {m.pct}% share
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Artifact & Signal Distribution */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Activity className="h-4 w-4 text-blue-700 dark:text-sky-400" />
                    <span>Flagged Signal Vectors</span>
                  </h2>
                  <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    {computedStats.suspiciousFiles} Flagged
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Distribution of suspicious detections by modality
                </p>

                <div className="mt-5 space-y-4">
                  {suspiciousByModality.map((row) => (
                    <div key={row.mod}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                          {row.label}
                        </span>
                        <span className="font-mono text-[11px] font-semibold tabular-nums text-blue-700 dark:text-sky-400 shrink-0">
                          {row.pct}% ({row.suspicious}/{row.total})
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-700 dark:bg-sky-400 transition-all"
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs dark:border-slate-800 dark:bg-[#0B1120]">
                <span className="text-slate-500 dark:text-slate-400">Primary Pipeline</span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                  2D-FFT · ELA · MFCC · Stylometry
                </span>
              </div>
            </div>

            {/* 3. Quick Forensic Dropzone */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Quick Forensic Dropzone
                </h2>
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
                  Fast Stage
                </span>
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  if (e.dataTransfer.files?.length) onQuickDropFiles(e.dataTransfer.files);
                }}
                className={`my-3 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-600 bg-blue-50/70 dark:border-sky-400 dark:bg-sky-500/10'
                    : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-500/60'
                }`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <p className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Drop asset or click to ingest
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  MP4, MOV, JPG, PNG, WAV, MP3, PDF, DOCX
                </p>
                <span className="mt-3.5 inline-flex items-center rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white dark:bg-sky-500 dark:text-slate-950">
                  Select Evidence File
                </span>
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.avi,.mp3,.wav,.m4a,.txt,.pdf,.docx"
                  onChange={(e) => {
                    if (e.target.files?.length) onQuickDropFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>

              <div className="space-y-1 border-t border-slate-100 pt-2.5 text-[11px] dark:border-slate-800">
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>Automated Checks:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-200">
                    Signal + Cross-Modal
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>Integrity Hash:</span>
                  <span className="font-mono text-blue-700 dark:text-sky-400">SHA-256 Digest</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Split: Case Records Table + Active Inspector Spotlight */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {/* Case Records Table */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-[#11192B] xl:col-span-8 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FILTER_OPTIONS.map((opt) => {
                      const count = statusCounts[opt.value] ?? 0;
                      const active = statusFilter === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setStatusFilter(opt.value);
                            setPage(1);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-blue-700 text-white dark:bg-sky-500 dark:text-slate-950'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                          }`}
                        >
                          {opt.label}{' '}
                          <span
                            className={`ml-1 font-mono tabular-nums ${
                              active
                                ? 'text-blue-100 dark:text-slate-900'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            ({count})
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative min-w-[200px] flex-1 max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchInput(e.target.value)}
                      placeholder="Filter case ID or title..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50/70 font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-[#0B1120]/60 dark:text-slate-400">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Case ID &amp; Evidence</th>
                        <th className="px-4 py-3 font-semibold">Media Type</th>
                        <th className="px-4 py-3 font-semibold">Forensic Verdict</th>
                        <th className="px-4 py-3 font-semibold">Files</th>
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-5 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {pagedInvestigations.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-5 py-10 text-center text-slate-500 dark:text-slate-400"
                          >
                            No investigations match your current filter.
                          </td>
                        </tr>
                      ) : (
                        pagedInvestigations.map((inv) => {
                          const items = evidenceByInvId.get(inv.id) ?? [];
                          const thumb = items.find((i) => i.modality === 'image');
                          const firstMod = (inv.modalities?.[0] ?? 'text') as EvidenceModality;
                          const Icon = modalityIcon(firstMod);
                          const isSpotlight = spotlightInv?.id === inv.id;

                          return (
                            <tr
                              key={inv.id}
                              onClick={() => onOpenInvestigation(inv.id)}
                              onMouseEnter={() => setSpotlightId(inv.id)}
                              className={`cursor-pointer transition-colors ${
                                isSpotlight
                                  ? 'bg-blue-50/35 dark:bg-sky-500/10'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                              }`}
                            >
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-3">
                                  {thumb ? (
                                    <img
                                      src={thumb.storagePath}
                                      alt={inv.title}
                                      className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                                    />
                                  ) : (
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700 dark:border-slate-700 dark:bg-[#0B1120] dark:text-sky-400">
                                      <Icon className="h-4 w-4" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-900 dark:text-slate-100 max-w-[220px]">
                                      {inv.title}
                                    </p>
                                    <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                      {inv.caseCode}
                                      {items[0]?.sha256Hash
                                        ? ` · ${items[0].sha256Hash.slice(0, 8)}`
                                        : ''}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3.5">
                                <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] uppercase text-slate-700 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-300">
                                  {Array.isArray(inv.modalities) && inv.modalities.length > 0
                                    ? inv.modalities.join(' · ')
                                    : '—'}
                                </span>
                              </td>
                              <td className="px-4 py-3.5">
                                <ClassificationBadge
                                  classification={inv.overallAssessment}
                                  confidence={inv.overallConfidence}
                                />
                              </td>
                              <td className="px-4 py-3.5 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                                {inv.evidenceCount}
                              </td>
                              <td className="px-4 py-3.5 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {new Date(inv.createdAt).toLocaleDateString()}
                              </td>
                              <td
                                className="px-5 py-3.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => onExportInvestigation(inv.id)}
                                    title="Download PDF Report"
                                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-700 dark:hover:bg-slate-800 dark:hover:text-sky-400 transition-colors"
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDeleteInvestigation(inv.id)}
                                    title="Delete Investigation"
                                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/15 dark:hover:text-rose-300 transition-colors"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span className="font-mono tabular-nums">
                  Showing{' '}
                  {filteredInvestigations.length === 0
                    ? 0
                    : (safePage - 1) * PAGE_SIZE + 1}
                  –{Math.min(safePage * PAGE_SIZE, filteredInvestigations.length)} of{' '}
                  {filteredInvestigations.length} records
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Prev</span>
                  </button>
                  <span className="px-2 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Active Inspector Spotlight */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] xl:col-span-4 flex flex-col justify-between">
              {spotlightInv ? (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Active Inspector Spotlight
                      </h2>
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200">
                        {spotlightInv.caseCode}
                      </span>
                    </div>

                    <div className="mt-3.5 overflow-hidden rounded-xl border border-slate-800 bg-[#0F172A]">
                      {spotlightImage ? (
                        <div className="relative">
                          <img
                            src={spotlightImage.elaPath || spotlightImage.storagePath}
                            alt={spotlightInv.title}
                            className="h-44 w-full object-cover opacity-90"
                          />
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-slate-950/80 px-3 py-2 text-[11px] backdrop-blur-xs">
                            <span className="truncate font-medium text-slate-200">
                              {spotlightImage.filename}
                            </span>
                            <span className="font-mono tabular-nums text-sky-300 shrink-0">
                              {spotlightImage.elaPath ? 'ELA Map' : 'Source'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-44 flex-col items-center justify-center p-5 text-center">
                          <p className="font-mono text-xs uppercase tracking-wider text-sky-400">
                            {spotlightInv.modalities?.join(' · ') || 'CASE SUMMARY'}
                          </p>
                          <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-100">
                            {spotlightInv.title}
                          </p>
                          <p className="mt-1 font-mono text-xs tabular-nums text-slate-400">
                            {spotlightInv.evidenceCount} analyzed file(s)
                          </p>
                        </div>
                      )}
                    </div>

                    <dl className="mt-4 divide-y divide-slate-100 text-xs dark:divide-slate-800/80">
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500 dark:text-slate-400">Overall Verdict</dt>
                        <dd className="font-semibold text-slate-900 dark:text-slate-100">
                          {spotlightInv.overallAssessment === 'No Significant Indicators Detected'
                            ? 'Looks Normal'
                            : spotlightInv.overallAssessment}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500 dark:text-slate-400">Confidence Score</dt>
                        <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {spotlightInv.overallConfidence}%
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2 gap-3">
                        <dt className="text-slate-500 dark:text-slate-400 shrink-0">Case Title</dt>
                        <dd className="truncate font-medium text-slate-800 dark:text-slate-200">
                          {spotlightInv.title}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {spotlightInv.summary}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenInvestigation(spotlightInv.id)}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200 dark:hover:border-sky-500 dark:hover:bg-sky-500/10 dark:hover:text-sky-300 transition-colors"
                  >
                    <span>Open Dual-Viewport Inspector</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <div className="flex h-full items-center justify-center py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  Select a case record to preview forensic telemetry.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
