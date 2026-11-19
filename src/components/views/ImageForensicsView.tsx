import { Eye, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EvidenceItem, ForensicFinding } from '../../types/forensics';
import { AiProbabilityMeter, ClassificationBadge, ExplainableFindingCard } from '../ForensicBadges';

export function ImageForensicsView({
  images,
  onGoToUpload,
}: {
  images: Array<EvidenceItem & { findings?: ForensicFinding[] }>;
  onGoToUpload: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(images[0]?.id ?? null);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'original' | 'ela'>('side-by-side');
  const [activeFindingId, setActiveFindingId] = useState<number | null>(null);

  useEffect(() => {
    if (images.length > 0 && !images.some((i) => i.id === selectedId)) {
      setSelectedId(images[0].id);
    }
  }, [images, selectedId]);

  if (images.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-[#11192B] p-12 text-center">
        <h3 className="text-base font-semibold text-slate-100">No Photos Yet</h3>
        <p className="mt-2 text-sm text-slate-400">
          Upload JPG, PNG, or WEBP photos in a new check to run frequency-domain FFT, pixel noise, edit heatmap, and visual content detection.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="mt-5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
        >
          Upload Photos
        </button>
      </div>
    );
  }

  const current = images.find((i) => i.id === selectedId) ?? images[0];
  const findings = current.findings ?? [];
  const regionFindings = findings.filter(
    (f) => f.regionJson && typeof f.regionJson.x === 'number'
  );

  const meta = current.metadataJson ?? {};
  const detectionLabel = typeof meta.detectionLabel === 'string' ? meta.detectionLabel : undefined;
  const aiProbability = typeof meta.aiProbability === 'number' ? meta.aiProbability : null;
  const fft = (meta.fftMetrics as Record<string, any> | undefined) ?? null;
  const noise = (meta.noiseMetrics as Record<string, any> | undefined) ?? null;
  const provenance = (meta.provenance as Record<string, any> | undefined) ?? null;

  return (
    <div className="space-y-6">
      {/* Mode Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#11192B] p-4">
        <div className="flex items-center gap-3">
          {images.length > 1 ? (
            <select
              value={current.id}
              onChange={(e) => {
                setSelectedId(Number(e.target.value));
                setActiveFindingId(null);
              }}
              className="rounded-lg border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  #{img.id} — {img.filename} ({String(img.metadataJson?.detectionLabel ?? img.classification)})
                </option>
              ))}
            </select>
          ) : (
            <ClassificationBadge
              classification={current.classification}
              confidence={current.confidence}
              detectionLabel={detectionLabel}
            />
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#0B1120] p-1 border border-slate-800">
          {(['side-by-side', 'original', 'ela'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === mode
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {mode === 'side-by-side'
                ? 'Side by Side'
                : mode === 'original'
                ? 'Original Photo'
                : 'Edit Heatmap'}
            </button>
          ))}
        </div>
      </div>

      {/* AI Probability Bar */}
      <AiProbabilityMeter
        detectionLabel={detectionLabel}
        aiProbability={aiProbability}
        confidence={current.confidence}
      />

      {/* Visual Inspection Canvas */}
      <div
        className={`grid gap-5 ${
          viewMode === 'side-by-side' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {viewMode !== 'ela' && (
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                <Eye className="h-3.5 w-3.5 text-sky-400" />
                Original Photo &amp; Highlighted Areas ({regionFindings.length})
              </span>
              <span className="font-mono" title={current.sha256Hash}>
                Fingerprint: {current.sha256Hash.slice(0, 12)}...
              </span>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120]">
              <img
                src={current.storagePath}
                alt={current.filename}
                className="mx-auto max-h-[460px] w-full object-contain"
              />
              {regionFindings.map((f) => {
                const r = f.regionJson!;
                const isActive = activeFindingId === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActiveFindingId(f.id)}
                    title={f.whatDetected}
                    style={{
                      left: `${r.x}%`,
                      top: `${r.y}%`,
                      width: `${r.width}%`,
                      height: `${r.height}%`,
                    }}
                    className={`absolute rounded border-2 transition-colors ${
                      isActive
                        ? 'border-sky-400 bg-sky-400/20'
                        : 'border-amber-400/80 bg-amber-400/10 hover:bg-amber-400/20'
                    }`}
                  >
                    <span className="absolute -top-5 left-0 rounded bg-[#0B1120]/90 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 whitespace-nowrap">
                      #{f.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {viewMode !== 'original' && (
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                <Layers className="h-3.5 w-3.5 text-sky-400" />
                Edit &amp; Compression Heatmap
              </span>
              <span className="font-mono tabular-nums">
                Avg Difference: {String(meta.elaMeanDelta ?? 'N/A')}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120]">
              {current.elaPath ? (
                <img
                  src={current.elaPath}
                  alt={`Edit heatmap for ${current.filename}`}
                  className="mx-auto max-h-[460px] w-full object-contain"
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-xs text-slate-500">
                  Edit heatmap unavailable for this photo format.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Assessment Summary + Content Signals + Optional Provenance */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5 lg:col-span-7 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Visual &amp; Content Analysis</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {current.technicalSummary}
            </p>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-slate-100">
              Findings ({findings.length})
            </h3>
            <div className="mt-3 space-y-2.5">
              {findings.length === 0 ? (
                <p className="text-xs text-slate-500">No suspicious visual artifacts recorded.</p>
              ) : (
                findings.map((f) => (
                  <ExplainableFindingCard
                    key={f.id}
                    finding={f}
                    active={activeFindingId === f.id}
                    onSelect={() => setActiveFindingId(f.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
            <h3 className="text-sm font-semibold text-slate-100">
              Pixel &amp; Frequency Signals (Primary)
            </h3>
            <dl className="mt-3 divide-y divide-slate-800/80 text-xs">
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Size &amp; Format</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {meta.width && meta.height
                    ? `${meta.width} × ${meta.height} px · ${String(meta.format ?? '').toUpperCase()}`
                    : String(meta.format ?? current.mimeType)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-400">2D-FFT High-Freq Ratio</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {fft ? `${(Number(fft.highFreqEnergyRatio) * 100).toFixed(1)}%` : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-400">FFT Upsampling Grid Peak</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {fft ? `${fft.periodicGridPeakRatio}x` : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Noise Residual (Laplacian)</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {noise ? `Mean ${noise.laplacianMean} · Uniformity ${noise.blockNoiseUniformity}` : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-400">Edit Heatmap Score</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {meta.elaMeanDelta !== undefined
                    ? `Avg ${meta.elaMeanDelta} · Peak ${meta.elaMaxDelta ?? '—'}`
                    : 'Unavailable'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
            <h3 className="text-sm font-semibold text-slate-100">
              Metadata &amp; Watermarks (Optional)
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Advisory context only. Missing EXIF or watermarks never classify an image as real or AI-generated.
            </p>
            <dl className="mt-3 divide-y divide-slate-800/80 text-xs">
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-slate-400">C2PA Content Credentials</dt>
                <dd className="text-slate-200">
                  {provenance?.hasC2paCredentials ? 'Present' : 'Not embedded'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-slate-400">Camera Info (EXIF)</dt>
                <dd className="text-slate-200">
                  {meta.hasCameraHardwareTags
                    ? [meta.make, meta.model].filter(Boolean).join(' ')
                    : 'Not present'}
                </dd>
              </div>
              {Boolean(meta.software) && (
                <div className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-slate-400">Edited With</dt>
                  <dd className="font-mono text-amber-300">{String(meta.software)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-slate-400">AI Generator Tags</dt>
                <dd className="text-slate-200">
                  {Array.isArray(provenance?.aiGeneratorSignatures) &&
                  provenance.aiGeneratorSignatures.length > 0
                    ? provenance.aiGeneratorSignatures.join(', ')
                    : 'None detected'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
