import {
  ArrowLeftRight,
  Columns2,
  Eye,
  Layers,
  Loader2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, ensureServerReady } from '../../lib/api';
import { EvidenceItem, ImageComparisonResult } from '../../types/forensics';

interface SlotSelection {
  file: File | null;
  previewUrl: string | null;
  existingId: number | null;
  existingName: string | null;
}

const EMPTY_SLOT: SlotSelection = {
  file: null,
  previewUrl: null,
  existingId: null,
  existingName: null,
};

function isAcceptedImage(filename: string): boolean {
  return /\.(jpg|jpeg|png|webp)$/i.test(filename);
}

export function CompareImagesView({
  previousImages,
}: {
  previousImages: EvidenceItem[];
}) {
  const { user } = useAuth();
  const [realSlot, setRealSlot] = useState<SlotSelection>(EMPTY_SLOT);
  const [suspSlot, setSuspSlot] = useState<SlotSelection>(EMPTY_SLOT);
  const [notes, setNotes] = useState('');
  const [dragTarget, setDragTarget] = useState<'real' | 'suspicious' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ImageComparisonResult | null>(null);
  const [inspectMode, setInspectMode] = useState<'side-by-side' | 'slider' | 'diff'>('side-by-side');
  const [sliderPos, setSliderPos] = useState(50);
  const [activeDiffIdx, setActiveDiffIdx] = useState<number | null>(null);

  const uniquePreviousImages = useMemo(() => {
    const seen = new Set<string>();
    return previousImages.filter((item) => {
      if (item.modality !== 'image') return false;
      const key = `${item.sha256Hash}-${item.filename}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [previousImages]);

  React.useEffect(() => {
    if (!submitting) {
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [submitting]);

  const setFileForSlot = async (target: 'real' | 'suspicious', file: File) => {
    setErrorMsg(null);
    if (!isAcceptedImage(file.name)) {
      setErrorMsg(`Unsupported format "${file.name}". Please upload JPG, PNG, or WEBP.`);
      return;
    }

    let safeFile = file;
    if (file.size <= 25 * 1024 * 1024) {
      try {
        const buf = await file.arrayBuffer();
        safeFile = new File([buf], file.name, {
          type: file.type,
          lastModified: file.lastModified,
        });
      } catch {
        // Fallback to original handle
      }
    }

    const previewUrl = URL.createObjectURL(safeFile);
    const updater = target === 'real' ? setRealSlot : setSuspSlot;
    updater((prev) => {
      if (prev.previewUrl && prev.file) URL.revokeObjectURL(prev.previewUrl);
      return {
        file: safeFile,
        previewUrl,
        existingId: null,
        existingName: null,
      };
    });
  };

  const selectExistingForSlot = (target: 'real' | 'suspicious', itemIdStr: string) => {
    setErrorMsg(null);
    const id = Number(itemIdStr);
    const item = uniquePreviousImages.find((i) => i.id === id);
    const updater = target === 'real' ? setRealSlot : setSuspSlot;
    if (!item) {
      updater((prev) => {
        if (prev.previewUrl && prev.file) URL.revokeObjectURL(prev.previewUrl);
        return EMPTY_SLOT;
      });
      return;
    }
    updater((prev) => {
      if (prev.previewUrl && prev.file) URL.revokeObjectURL(prev.previewUrl);
      return {
        file: null,
        previewUrl: item.storagePath,
        existingId: item.id,
        existingName: item.filename,
      };
    });
  };

  const clearSlot = (target: 'real' | 'suspicious') => {
    const updater = target === 'real' ? setRealSlot : setSuspSlot;
    updater((prev) => {
      if (prev.previewUrl && prev.file) URL.revokeObjectURL(prev.previewUrl);
      return EMPTY_SLOT;
    });
  };

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if ((!realSlot.file && !realSlot.existingId) || (!suspSlot.file && !suspSlot.existingId)) {
      setErrorMsg('Please select both a Real Reference photo and a Suspicious photo to compare.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    setProgressStage('Connecting to analysis server...');
    setActiveDiffIdx(null);

    try {
      const readiness = await ensureServerReady(12_000);
      if (readiness === 'auth_redirect') {
        throw new Error(
          'Your preview session expired. Please click the Reload icon (↻) at the top of the preview bar, then try again.'
        );
      }
      if (readiness === 'timeout') {
        throw new Error(
          'Analysis server is still waking up. Please wait a moment and click Compare Photos again.'
        );
      }

      const formData = new FormData();
      if (realSlot.file) {
        formData.append('realImage', realSlot.file);
      } else if (realSlot.existingId) {
        formData.append('realEvidenceId', String(realSlot.existingId));
      }

      if (suspSlot.file) {
        formData.append('suspiciousImage', suspSlot.file);
      } else if (suspSlot.existingId) {
        formData.append('suspiciousEvidenceId', String(suspSlot.existingId));
      }

      if (notes.trim()) {
        formData.append('notes', notes.trim());
      }

      setProgressStage('Comparing pixel noise, 2D-FFT spectrum, and visual details...');
      const res = await apiFetch<{ comparison: ImageComparisonResult }>(
        user,
        '/api/images/compare',
        {
          method: 'POST',
          body: formData,
        }
      );

      setResult(res.comparison);
      setInspectMode('side-by-side');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Comparison failed. Please retry with valid image files.');
    } finally {
      setSubmitting(false);
      setProgressStage('');
    }
  };

  const verdictStyles = (verdict: ImageComparisonResult['verdict']) => {
    if (verdict === 'AI-GENERATED' || verdict === 'MANIPULATED / EDITED') {
      return {
        border: 'border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10',
        text: 'text-rose-700 dark:text-rose-300',
        bar: 'bg-rose-600 dark:bg-rose-500',
      };
    }
    if (verdict === 'REAL / AUTHENTIC') {
      return {
        border: 'border-blue-200 bg-blue-50/60 dark:border-sky-500/30 dark:bg-sky-500/10',
        text: 'text-blue-700 dark:text-sky-300',
        bar: 'bg-blue-700 dark:bg-sky-400',
      };
    }
    return {
      border: 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10',
      text: 'text-amber-800 dark:text-amber-300',
      bar: 'bg-amber-500 dark:bg-amber-400',
    };
  };

  const renderUploadSlot = (
    target: 'real' | 'suspicious',
    slot: SlotSelection,
    stepNum: string,
    stepTitle: string,
    subtitle: string
  ) => {
    const isReal = target === 'real';
    const hasFile = Boolean(slot.previewUrl);

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4 dark:border-slate-800 dark:bg-[#11192B]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 font-mono text-xs font-bold text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                {stepNum}
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {stepTitle}
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
          {hasFile && (
            <button
              type="button"
              onClick={() => clearSlot(target)}
              className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 transition-colors"
              aria-label={`Remove ${stepTitle}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {hasFile && slot.previewUrl ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#0F172A] dark:border-slate-700">
            <img
              src={slot.previewUrl}
              alt={slot.file?.name || slot.existingName || stepTitle}
              className="mx-auto h-64 w-full object-contain"
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-[#0B1120]">
              <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {slot.file?.name || slot.existingName}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {slot.file ? `${(slot.file.size / 1024).toFixed(1)} KB` : 'Saved photo'}
              </span>
            </div>
          </div>
        ) : (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragTarget(target);
            }}
            onDragLeave={() => setDragTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragTarget(null);
              const f = e.dataTransfer.files?.[0];
              if (f) void setFileForSlot(target, f);
            }}
            className={`flex h-64 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragTarget === target
                ? 'border-blue-600 bg-blue-50/70 dark:border-sky-400 dark:bg-sky-500/10'
                : 'border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-500/60'
            }`}
          >
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-full ${
                isReal
                  ? 'bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400'
              }`}
            >
              <UploadCloud className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isReal ? 'Drop your Real Reference photo here' : 'Drop the Suspicious photo here'}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
              JPG, PNG, or WEBP · Max 60 MB
            </p>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void setFileForSlot(target, f);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        )}

        {uniquePreviousImages.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Or reuse a previously checked photo
            </label>
            <select
              value={slot.existingId ? String(slot.existingId) : ''}
              onChange={(e) => selectExistingForSlot(target, e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500"
            >
              <option value="">Select a saved photo...</option>
              {uniquePreviousImages.map((img) => (
                <option key={img.id} value={img.id}>
                  #{img.id} — {img.filename}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleCompare} className="space-y-5">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
            Dual Reference Verification
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Compare Real vs. Suspicious Photo
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Upload a genuine reference photo alongside a suspicious photo to check for AI generation, face swaps, or localized edits using pixel noise, frequency spectrum, and visual inspection.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {renderUploadSlot(
            'real',
            realSlot,
            '01',
            'Real Reference Photo',
            'A verified camera photo or original image to use as the baseline.'
          )}
          {renderUploadSlot(
            'suspicious',
            suspSlot,
            '02',
            'Suspicious Photo',
            'The image you want to verify against AI generation or manipulation.'
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                What would you like to double-check? (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Check whether the face, background, or lighting was AI-generated or edited..."
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors disabled:opacity-60 shrink-0"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {progressStage || 'Comparing photos...'} ({elapsedSec}s)
                  </span>
                </>
              ) : (
                <>
                  <Columns2 className="h-4 w-4" />
                  <span>Compare Photos</span>
                </>
              )}
            </button>
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              {errorMsg}
            </div>
          )}
        </div>
      </form>

      {result && (
        <div className="space-y-6">
          {/* Verdict & Probability Summary */}
          {(() => {
            const st = verdictStyles(result.verdict);
            const prob = result.suspiciousAiProbability;
            return (
              <div className={`rounded-xl border p-5 space-y-4 ${st.border}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Suspicious Photo Assessment
                    </p>
                    <h2 className={`mt-0.5 text-xl font-bold tracking-tight ${st.text}`}>
                      {result.verdict}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 text-xs">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">AI Probability</span>
                      <p className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
                        {prob !== null ? `${prob}%` : 'Unavailable'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Confidence</span>
                      <p className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
                        {result.confidence}%
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Pixel Similarity</span>
                      <p className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
                        {result.pixelSimilarityPct}%
                      </p>
                    </div>
                  </div>
                </div>

                {prob !== null && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/80 dark:bg-slate-900/80">
                    <div
                      className={`h-full transition-all ${st.bar}`}
                      style={{ width: `${Math.max(3, prob)}%` }}
                    />
                  </div>
                )}

                <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {result.summary}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-medium">
                    {result.sameSceneOrSubject
                      ? 'Matching scene/subject detected'
                      : 'Different scene or framing baseline'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{result.limitations}</span>
                </div>
              </div>
            );
          })()}

          {/* Interactive Comparison View Switcher */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4 dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Visual &amp; Pixel Comparison
              </h3>

              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-[#0B1120]">
                {(['side-by-side', 'slider', 'diff'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setInspectMode(mode)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      inspectMode === mode
                        ? 'bg-blue-700 text-white dark:bg-sky-500 dark:text-slate-950'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                    }`}
                  >
                    {mode === 'side-by-side'
                      ? 'Side by Side'
                      : mode === 'slider'
                      ? 'Before / After Slider'
                      : 'Pixel Diff Heatmap'}
                  </button>
                ))}
              </div>
            </div>

            {inspectMode === 'side-by-side' && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-sky-300">
                      <Eye className="h-3.5 w-3.5" />
                      Real Reference: {result.realImage.filename}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {result.realImage.width} × {result.realImage.height}
                    </span>
                  </div>
                  <img
                    src={result.realImage.previewUrl}
                    alt={result.realImage.filename}
                    className="mx-auto max-h-[440px] w-full rounded object-contain"
                  />
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-amber-300">
                      <Eye className="h-3.5 w-3.5" />
                      Suspicious Photo: {result.suspiciousImage.filename}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {result.suspiciousImage.width} × {result.suspiciousImage.height}
                    </span>
                  </div>
                  <div className="relative overflow-hidden rounded">
                    <img
                      src={result.suspiciousImage.previewUrl}
                      alt={result.suspiciousImage.filename}
                      className="mx-auto max-h-[440px] w-full object-contain"
                    />
                    {result.differences.map((d, idx) => {
                      if (!d.suspiciousRegion) return null;
                      const r = d.suspiciousRegion;
                      const isActive = activeDiffIdx === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveDiffIdx(idx)}
                          title={d.area}
                          style={{
                            left: `${r.x}%`,
                            top: `${r.y}%`,
                            width: `${r.width}%`,
                            height: `${r.height}%`,
                          }}
                          className={`absolute rounded border-2 transition-colors ${
                            isActive
                              ? 'border-sky-400 bg-sky-400/20'
                              : d.significance === 'Suspicious'
                              ? 'border-rose-400/80 bg-rose-400/10 hover:bg-rose-400/20'
                              : 'border-amber-400/80 bg-amber-400/10 hover:bg-amber-400/20'
                          }`}
                        >
                          <span className="absolute -top-5 left-0 rounded bg-slate-950/90 px-1.5 py-0.5 font-mono text-[10px] text-slate-100 whitespace-nowrap">
                            #{idx + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {inspectMode === 'slider' && (
              <div className="space-y-3">
                <div className="relative mx-auto max-w-2xl overflow-hidden rounded-xl border border-slate-800 bg-[#0F172A]">
                  <img
                    src={result.suspiciousImage.previewUrl}
                    alt={result.suspiciousImage.filename}
                    className="block max-h-[460px] w-full object-contain"
                  />
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                  >
                    <img
                      src={result.realImage.previewUrl}
                      alt={result.realImage.filename}
                      className="block max-h-[460px] w-full object-contain"
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400"
                    style={{ left: `${sliderPos}%` }}
                  />
                  <div className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/85 px-2 py-1 text-[11px] font-medium text-sky-300">
                    Real Reference
                  </div>
                  <div className="pointer-events-none absolute right-3 top-3 rounded bg-slate-950/85 px-2 py-1 text-[11px] font-medium text-amber-300">
                    Suspicious Photo
                  </div>
                </div>

                <div className="mx-auto flex max-w-2xl items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                  <ArrowLeftRight className="h-4 w-4 shrink-0 text-blue-700 dark:text-sky-400" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPos}
                    onChange={(e) => setSliderPos(Number(e.target.value))}
                    className="w-full accent-blue-700 dark:accent-sky-400"
                  />
                  <span className="w-10 text-right font-mono tabular-nums">{sliderPos}%</span>
                </div>
              </div>
            )}

            {inspectMode === 'diff' && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-sky-300">
                      <Layers className="h-3.5 w-3.5" />
                      Pixel Difference Heatmap (5× Amplified)
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      Mean Delta: {result.meanPixelDiffPct}%
                    </span>
                  </div>
                  {result.diffHeatmapUrl ? (
                    <img
                      src={result.diffHeatmapUrl}
                      alt="Pixel difference heatmap"
                      className="mx-auto max-h-[420px] w-full rounded object-contain"
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center text-xs text-slate-400">
                      Pixel difference map unavailable.
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 flex flex-col justify-between space-y-4 dark:border-slate-800 dark:bg-[#0B1120]">
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      How to read the Pixel Diff Heatmap
                    </h4>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Bright areas highlight pixels where the suspicious photo diverges from the real reference after alignment. If both photos depict the same scene, localized bright patches reveal altered faces, swapped objects, or AI inpainting. If the photos are from different scenes, compare the signal table below instead.
                    </p>
                  </div>
                  <dl className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-slate-500 dark:text-slate-400">
                        Structural Pixel Similarity
                      </dt>
                      <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {result.pixelSimilarityPct}%
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-slate-500 dark:text-slate-400">Mean RGB Pixel Difference</dt>
                      <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {result.meanPixelDiffPct}%
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <dt className="text-slate-500 dark:text-slate-400">
                        Noise Residual Gap (Suspicious − Real)
                      </dt>
                      <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {result.noiseDelta !== null
                          ? `${result.noiseDelta > 0 ? '+' : ''}${result.noiseDelta}`
                          : 'N/A'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}
          </div>

          {/* Observed Differences + Signal Comparison */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Key Differences Observed ({result.differences.length})
              </h3>
              {result.differences.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No itemized region differences returned. Review the summary and signal metrics alongside both photos.
                </p>
              ) : (
                <div className="space-y-3">
                  {result.differences.map((diff, idx) => {
                    const active = activeDiffIdx === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveDiffIdx(idx);
                          setInspectMode('side-by-side');
                        }}
                        className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                          active
                            ? 'border-blue-600 bg-blue-50/40 dark:border-sky-400 dark:bg-sky-500/10'
                            : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 dark:border-slate-800 dark:bg-[#0B1120] dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            #{idx + 1} · {diff.area}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${
                              diff.significance === 'Suspicious'
                                ? 'text-rose-700 dark:text-rose-300'
                                : diff.significance === 'Consistent'
                                ? 'text-blue-700 dark:text-sky-300'
                                : 'text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {diff.significance}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
                          <div>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              Real Photo:
                            </span>
                            <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                              {diff.realObservation}
                            </p>
                          </div>
                          <div>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              Suspicious Photo:
                            </span>
                            <p className="mt-0.5 text-slate-900 dark:text-slate-100">
                              {diff.suspiciousObservation}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-6">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Signal &amp; Metadata Comparison
              </h3>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Primary metrics measure actual pixel noise, frequency harmonics, and compression residuals. Metadata is advisory only.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="pb-2 font-semibold">Signal</th>
                      <th className="pb-2 font-semibold">Real Reference</th>
                      <th className="pb-2 font-semibold">Suspicious Photo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">
                        Dimensions &amp; Format
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.realImage.width}×{result.realImage.height} ·{' '}
                        {result.realImage.format.toUpperCase()}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.suspiciousImage.width}×{result.suspiciousImage.height} ·{' '}
                        {result.suspiciousImage.format.toUpperCase()}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">
                        2D-FFT High-Freq Ratio
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.realImage.fftMetrics
                          ? `${(result.realImage.fftMetrics.highFreqEnergyRatio * 100).toFixed(1)}%`
                          : 'N/A'}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.suspiciousImage.fftMetrics
                          ? `${(result.suspiciousImage.fftMetrics.highFreqEnergyRatio * 100).toFixed(1)}%`
                          : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">FFT Grid Peak</td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.realImage.fftMetrics
                          ? `${result.realImage.fftMetrics.periodicGridPeakRatio}x`
                          : 'N/A'}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.suspiciousImage.fftMetrics
                          ? `${result.suspiciousImage.fftMetrics.periodicGridPeakRatio}x`
                          : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">
                        Noise Residual (Mean)
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.realImage.laplacianMean ?? 'N/A'}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.suspiciousImage.laplacianMean ?? 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">Noise Uniformity</td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.realImage.blockNoiseUniformity ?? 'N/A'}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.suspiciousImage.blockNoiseUniformity ?? 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">
                        Edit Heatmap (Mean / Max)
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.realImage.elaMeanDelta} / {result.realImage.elaMaxDelta}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {result.suspiciousImage.elaMeanDelta} / {result.suspiciousImage.elaMaxDelta}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">
                        Camera EXIF (Advisory)
                      </td>
                      <td className="py-2.5 text-slate-700 dark:text-slate-300">
                        {result.realImage.cameraLabel || 'Not present'}
                      </td>
                      <td className="py-2.5 text-slate-700 dark:text-slate-300">
                        {result.suspiciousImage.cameraLabel || 'Not present'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-slate-500 dark:text-slate-400">
                        AI Generator Tags
                      </td>
                      <td className="py-2.5 text-slate-700 dark:text-slate-300">
                        {result.realImage.provenance.aiGeneratorSignatures.length > 0
                          ? result.realImage.provenance.aiGeneratorSignatures.join(', ')
                          : 'None'}
                      </td>
                      <td className="py-2.5 text-slate-700 dark:text-slate-300">
                        {result.suspiciousImage.provenance.aiGeneratorSignatures.length > 0
                          ? result.suspiciousImage.provenance.aiGeneratorSignatures.join(', ')
                          : 'None'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
