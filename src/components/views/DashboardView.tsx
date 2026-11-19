import { Download, FilePlus2, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DashboardData, ForensicClassification } from '../../types/forensics';
import { ClassificationBadge } from '../ForensicBadges';

const FILTER_OPTIONS: Array<'All' | ForensicClassification> = [
  'All',
  'Suspicious',
  'No Significant Indicators Detected',
  'Inconclusive',
  'Analysis Unavailable',
];

export function DashboardView({
  data,
  loading,
  onNewInvestigation,
  onOpenInvestigation,
  onExportInvestigation,
  onDeleteInvestigation,
}: {
  data: DashboardData | null;
  loading: boolean;
  onNewInvestigation: () => void;
  onOpenInvestigation: (id: number) => void;
  onExportInvestigation: (id: number) => void;
  onDeleteInvestigation: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ForensicClassification>('All');

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-[#11192B]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border border-slate-800 bg-[#11192B]" />
      </div>
    );
  }

  const stats = data?.stats ?? {
    totalFiles: 0,
    suspiciousFiles: 0,
    verifiedLowRiskFiles: 0,
    totalInvestigations: 0,
    modalityCounts: { image: 0, video: 0, audio: 0, text: 0 },
    classificationCounts: {
      Suspicious: 0,
      'No Significant Indicators Detected': 0,
      Inconclusive: 0,
      'Analysis Unavailable': 0,
    },
  };

  const modalityChartData = [
    { name: 'Images', count: stats.modalityCounts.image },
    { name: 'Videos', count: stats.modalityCounts.video },
    { name: 'Audio', count: stats.modalityCounts.audio },
    { name: 'Text', count: stats.modalityCounts.text },
  ];

  const investigations = data?.investigations ?? [];
  const filtered = investigations.filter((inv) => {
    const matchesStatus =
      statusFilter === 'All' || inv.overallAssessment === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q ||
      inv.title.toLowerCase().includes(q) ||
      inv.caseCode.toLowerCase().includes(q) ||
      inv.description.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  if (investigations.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-dashed border-slate-700 bg-[#11192B] p-12 text-center">
          <h2 className="text-lg font-semibold text-slate-100">Welcome to TruthLens</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Upload photos, videos, audio clips, or documents into one case to check for signs of editing and compare them together.
          </p>
          <button
            type="button"
            onClick={onNewInvestigation}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 transition-colors"
          >
            <FilePlus2 className="h-4 w-4" />
            <span>Start New Check</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
            <h3 className="text-xs font-semibold text-slate-100">Photo Check</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Checks camera tags, creates an edit heatmap, and highlights suspicious areas in JPG, PNG, or WEBP photos.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
            <h3 className="text-xs font-semibold text-slate-100">Video Check</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Extracts key video frames and flags unnatural lighting, face, or temporal shifts in MP4, MOV, or AVI files.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
            <h3 className="text-xs font-semibold text-slate-100">Voice &amp; Audio Check</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Generates an interactive waveform, transcribes speech, and screens MP3, WAV, or M4A clips for synthetic voice signs.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
            <h3 className="text-xs font-semibold text-slate-100">Text &amp; Cross-Check</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Compares TXT, PDF, DOCX, or captions against your media to catch mismatches and export a full PDF report.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Compact Metrics + Single Chart Row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="grid grid-cols-3 gap-4 lg:col-span-5 lg:grid-cols-1">
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#11192B] px-5 py-4">
            <div>
              <p className="text-xs text-slate-400">Files Checked</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-50">
                {stats.totalFiles}
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500">
              {stats.totalInvestigations} cases
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#11192B] px-5 py-4">
            <div>
              <p className="text-xs text-slate-400">Flagged for Review</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-300">
                {stats.suspiciousFiles}
              </p>
            </div>
            <span className="text-xs text-slate-500">Suspicious signs</span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#11192B] px-5 py-4">
            <div>
              <p className="text-xs text-slate-400">Looks Normal</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-300">
                {stats.verifiedLowRiskFiles}
              </p>
            </div>
            <span className="text-xs text-slate-500">No edit signs</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Files by Type</h2>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {stats.totalFiles} total
            </span>
          </div>
          <div className="mt-3 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modalityChartData} margin={{ top: 6, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={12} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#F8FAFC',
                  }}
                />
                <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Unified Investigations List & Filter */}
      <div className="rounded-xl border border-slate-800 bg-[#11192B]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
          <div className="relative min-w-[220px] flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases..."
              className="w-full rounded-lg border border-slate-700 bg-[#0B1120] pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-[#0B1120] p-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setStatusFilter(opt)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === opt
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {opt === 'No Significant Indicators Detected' ? 'Looks Normal' : opt}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800/80 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">File Types</th>
                <th className="px-4 py-3 font-medium text-right">Files</th>
                <th className="px-4 py-3 font-medium">Result</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No matching investigations.
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => onOpenInvestigation(inv.id)}
                    className="cursor-pointer hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">{inv.title}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{inv.caseCode}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-300">
                      {Array.isArray(inv.modalities) && inv.modalities.length > 0
                        ? inv.modalities.join(' · ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                      {inv.evidenceCount}
                    </td>
                    <td className="px-4 py-3">
                      <ClassificationBadge
                        classification={inv.overallAssessment}
                        confidence={inv.overallConfidence}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onExportInvestigation(inv.id)}
                          title="Download PDF Report"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-400"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteInvestigation(inv.id)}
                          title="Delete Investigation"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
