import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, HelpCircle, Slash } from 'lucide-react';
import { useState } from 'react';
import { ForensicClassification, ForensicFinding } from '../types/forensics';

export function ClassificationBadge({
  classification,
  confidence,
  detectionLabel,
}: {
  classification: ForensicClassification;
  confidence?: number;
  detectionLabel?: string;
}) {
  const config: Record<
    ForensicClassification,
    { icon: typeof AlertTriangle; color: string; bg: string; border: string }
  > = {
    Suspicious: {
      icon: AlertTriangle,
      color: 'text-amber-300',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
    },
    'No Significant Indicators Detected': {
      icon: CheckCircle2,
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
    },
    Inconclusive: {
      icon: HelpCircle,
      color: 'text-slate-300',
      bg: 'bg-slate-500/10',
      border: 'border-slate-500/30',
    },
    'Analysis Unavailable': {
      icon: Slash,
      color: 'text-rose-300',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
    },
  };

  const c = config[classification] ?? config.Inconclusive;
  const Icon = c.icon;
  const displayText =
    detectionLabel && classification !== 'Analysis Unavailable'
      ? detectionLabel
      : classification === 'No Significant Indicators Detected'
      ? 'Looks Normal'
      : classification;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${c.bg} ${c.border} ${c.color}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{displayText}</span>
      {typeof confidence === 'number' && classification !== 'Analysis Unavailable' && (
        <span className="font-mono tabular-nums opacity-80">· {confidence}%</span>
      )}
    </span>
  );
}

export function AiProbabilityMeter({
  detectionLabel,
  aiProbability,
  confidence,
}: {
  detectionLabel?: string;
  aiProbability?: number | null;
  confidence: number;
}) {
  const prob = typeof aiProbability === 'number' ? Math.max(0, Math.min(100, aiProbability)) : null;
  const barColor =
    prob === null
      ? 'bg-slate-600'
      : prob >= 65
      ? 'bg-amber-400'
      : prob <= 35
      ? 'bg-emerald-400'
      : 'bg-sky-400';

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-200">
          {detectionLabel ? `Detection Result: ${detectionLabel}` : 'AI Likelihood Estimate'}
        </span>
        <div className="flex items-center gap-4 font-mono tabular-nums text-slate-300">
          <span>AI Probability: {prob !== null ? `${prob}%` : 'Unavailable'}</span>
          <span className="text-slate-400">Confidence: {confidence}%</span>
        </div>
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${prob ?? 0}%` }}
        />
      </div>
    </div>
  );
}

export function ExplainableFindingCard({
  finding,
  active,
  onSelect,
}: {
  finding: ForensicFinding;
  active?: boolean;
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(finding.classification === 'Suspicious');

  const handleToggle = () => {
    setExpanded((prev) => !prev);
    if (onSelect) onSelect();
  };

  return (
    <div
      className={`rounded-lg border transition-colors ${
        active
          ? 'border-sky-400 bg-[#1A253D]'
          : 'border-slate-800 bg-[#0E1627] hover:border-slate-700'
      }`}
    >
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-start justify-between gap-3 p-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-slate-100">{finding.whatDetected}</h4>
          </div>
          <p className="mt-1 text-xs text-slate-400 truncate">
            {finding.whereDetected} · {finding.analysisMethod}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ClassificationBadge
            classification={finding.classification}
            confidence={finding.confidence}
          />
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-slate-800/80 px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-slate-300">
            <span className="font-medium text-slate-100">Why flagged: </span>
            {finding.whyFlagged}
          </p>
          <p className="text-slate-400">
            <span className="font-medium text-slate-300">Limitations: </span>
            {finding.limitations}
          </p>
        </div>
      )}
    </div>
  );
}
