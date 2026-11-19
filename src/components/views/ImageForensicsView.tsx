import {
  Activity,
  ArrowLeftRight,
  Columns2,
  Eye,
  Focus,
  Image as ImageIcon,
  Layers,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../context/ThemeContext';
import { EvidenceItem, ForensicFinding } from '../../types/forensics';
import { AiProbabilityMeter, ClassificationBadge, ExplainableFindingCard } from '../ForensicBadges';

type InspectorMode = 'side-by-side' | 'split' | 'original' | 'ela';
type ZoomLevel = 'fit' | 1 | 1.5 | 2;

export function ImageForensicsView({
  images,
  onGoToUpload,
}: {
  images: Array<EvidenceItem & { findings?: ForensicFinding[] }>;
  onGoToUpload: () => void;
}) {
  const { theme } = useTheme();
  const [selectedId, setSelectedId] = useState<number | null>(images[0]?.id ?? null);
  const [viewMode, setViewMode] = useState<InspectorMode>('side-by-side');
  const [zoom, setZoom] = useState<ZoomLevel>('fit');
  const [showRois, setShowRois] = useState(true);
  const [splitPos, setSplitPos] = useState(50);
  const [activeFindingId, setActiveFindingId] = useState<number | null>(null);

  useEffect(() => {
    if (images.length > 0 && !images.some((i) => i.id === selectedId)) {
      setSelectedId(images[0].id);
    }
  }, [images, selectedId]);

  const current = images.find((i) => i.id === selectedId) ?? images[0];
  const meta = current?.metadataJson ?? {};
  const fft = (meta.fftMetrics as Record<string, any> | undefined) ?? null;

  const spectrumSeries = useMemo(() => {
    if (!fft) return [];
    const hfRatio = Number(fft.highFreqEnergyRatio ?? 0.02);
    const peak = Number(fft.periodicGridPeakRatio ?? 1.2);
    const slope = Math.abs(Number(fft.radialDropoffSlope ?? 1.5));
    return Array.from({ length: 12 }, (_, idx) => {
      const freq = idx + 1;
      const baseEnergy = Math.max(0.03, Math.exp(-slope * (idx / 5)) * (1 + hfRatio * 4));
      const spike = idx === 8 && peak > 2.5 ? Math.min(0.45, (peak - 2) * 0.08) : 0;
      return {
        band: `${Math.round((freq / 12) * 100)}%`,
        energy: Number((baseEnergy + spike).toFixed(3)),
      };
    });
  }, [fft]);

  if (images.length === 0 || !current) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-[#11192B]">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">No Photos Yet</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Upload JPG, PNG, or WEBP photos in a new investigation to run 2D-FFT frequency analysis, pixel noise residuals, edit heatmaps, and visual inspection.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="mt-5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
        >
          Upload Photos
        </button>
      </div>
    );
  }

  const findings = current.findings ?? [];
  const regionFindings = findings.filter(
    (f) => f.regionJson && typeof f.regionJson.x === 'number'
  );

  const detectionLabel = typeof meta.detectionLabel === 'string' ? meta.detectionLabel : undefined;
  const aiProbability = typeof meta.aiProbability === 'number' ? meta.aiProbability : null;
  const noise = (meta.noiseMetrics as Record<string, any> | undefined) ?? null;
  const provenance = (meta.provenance as Record<string, any> | undefined) ?? null;
  const imgWidth = Number(meta.width ?? 0);
  const imgHeight = Number(meta.height ?? 0);

  const zoomScaleStyle =
    zoom === 'fit'
      ? undefined
      : {
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
        };

  return (
    <div className="space-y-5">
      {/* Inspector Mode & Zoom Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'side-by-side', label: 'Side by Side', icon: Columns2 },
              { id: 'split', label: 'Split Slider', icon: ArrowLeftRight },
              { id: 'original', label: 'Original Only', icon: ImageIcon },
              { id: 'ela', label: 'Error Level Analysis (ELA)', icon: Layers },
            ] as const
          ).map((mode) => {
            const Icon = mode.icon;
            const active = viewMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-700 text-white shadow-2xs dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {images.length > 1 && (
            <select
              value={current.id}
              onChange={(e) => {
                setSelectedId(Number(e.target.value));
                setActiveFindingId(null);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500"
            >
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  #{img.id} — {img.filename}
                </option>
              ))}
            </select>
          )}

          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-[#0B1120]">
            <span className="px-1.5 font-mono text-[10px] font-semibold uppercase text-slate-400">
              Zoom:
            </span>
            {(
              [
                { value: 'fit', label: 'FIT' },
                { value: 1, label: '100%' },
                { value: 1.5, label: '150%' },
                { value: 2, label: '200%' },
              ] as const
            ).map((z) => (
              <button
                key={String(z.value)}
                type="button"
                onClick={() => setZoom(z.value)}
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors ${
                  zoom === z.value
                    ? 'bg-blue-700 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowRois((r) => !r)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
              showRois
                ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Focus className="h-3.5 w-3.5" />
            <span>
              ROIs {showRois ? 'Active' : 'Hidden'} ({regionFindings.length})
            </span>
          </button>
        </div>
      </div>

      {/* AI Probability Bar */}
      <AiProbabilityMeter
        detectionLabel={detectionLabel}
        aiProbability={aiProbability}
        confidence={current.confidence}
      />

      {/* Inspection Canvas */}
      {viewMode === 'split' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
              <ArrowLeftRight className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400" />
              Split Slider: Original Image vs. Edit Heatmap (ELA)
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
              Avg Delta: {String(meta.elaMeanDelta ?? 'N/A')} · Peak:{' '}
              {String(meta.elaMaxDelta ?? 'N/A')}
            </span>
          </div>

          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-800 bg-[#0F172A]">
            {current.elaPath ? (
              <>
                <img
                  src={current.elaPath}
                  alt={`Edit heatmap for ${current.filename}`}
                  className="block max-h-[480px] w-full object-contain"
                />
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
                >
                  <img
                    src={current.storagePath}
                    alt={current.filename}
                    className="block max-h-[480px] w-full object-contain"
                  />
                </div>
                <div
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]"
                  style={{ left: `${splitPos}%` }}
                />
                <div className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/85 px-2.5 py-1 font-mono text-[11px] font-medium text-sky-300">
                  Original
                </div>
                <div className="pointer-events-none absolute right-3 top-3 rounded bg-slate-950/85 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-300">
                  ELA Heatmap
                </div>
              </>
            ) : (
              <div className="flex h-72 items-center justify-center text-xs text-slate-400">
                ELA heatmap unavailable for split comparison on this format.
              </div>
            )}
          </div>

          {current.elaPath && (
            <div className="mx-auto flex max-w-4xl items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-mono text-[11px] font-semibold">Original</span>
              <input
                type="range"
                min={0}
                max={100}
                value={splitPos}
                onChange={(e) => setSplitPos(Number(e.target.value))}
                className="w-full accent-blue-700 dark:accent-sky-400"
              />
              <span className="font-mono text-[11px] font-semibold">ELA</span>
              <span className="w-10 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {splitPos}%
              </span>
            </div>
          )}
        </div>
      ) : (
        <div
          className={`grid gap-5 ${
            viewMode === 'side-by-side' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {viewMode !== 'ela' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] flex flex-col justify-between">
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Eye className="h-4 w-4 text-blue-700 dark:text-sky-400" />
                    Original Image &amp; ROI Biometrics
                  </span>
                  <div className="flex items-center gap-2">
                    <ClassificationBadge
                      classification={current.classification}
                      detectionLabel={detectionLabel}
                    />
                    <span
                      className="hidden sm:inline font-mono text-[11px] text-slate-500 dark:text-slate-400"
                      title={current.sha256Hash}
                    >
                      {current.sha256Hash.slice(0, 10)}...
                    </span>
                  </div>
                </div>

                {/* Dark Forensic Viewport */}
                <div className="relative overflow-auto rounded-xl border border-slate-800 bg-[#0F172A] p-3">
                  <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
                    <span>+ [X:000 Y:000]</span>
                    <span>[X:{imgWidth || '—'} Y:000] +</span>
                  </div>

                  <div
                    className="relative mx-auto w-fit transition-transform duration-150"
                    style={zoomScaleStyle}
                  >
                    <img
                      src={current.storagePath}
                      alt={current.filename}
                      className="mx-auto max-h-[430px] w-full rounded object-contain"
                    />
                    {showRois &&
                      regionFindings.map((f) => {
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
                                : f.classification === 'Suspicious'
                                ? 'border-rose-400/85 bg-rose-400/10 hover:bg-rose-400/20'
                                : 'border-sky-300/75 bg-sky-400/10 hover:bg-sky-400/20'
                            }`}
                          >
                            <span className="absolute -top-5 left-0 rounded bg-slate-950/90 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 whitespace-nowrap">
                              ROI #{f.id}
                            </span>
                          </button>
                        );
                      })}
                  </div>

                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
                    <span>+ [X:000 Y:{imgHeight || '—'}]</span>
                    <span>
                      [X:{imgWidth || '—'} Y:{imgHeight || '—'}] +
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <span>
                  ROI DETECTIONS:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {regionFindings.length} Regions
                  </strong>
                </span>
                <span>
                  {imgWidth && imgHeight ? `${imgWidth} × ${imgHeight} px` : current.mimeType}
                </span>
              </div>
            </div>
          )}

          {viewMode !== 'original' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] flex flex-col justify-between">
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Layers className="h-4 w-4 text-blue-700 dark:text-sky-400" />
                    Edit &amp; Compression Heatmap (ELA)
                  </span>
                  <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
                    <span>
                      AVG DELTA:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {String(meta.elaMeanDelta ?? 'N/A')}
                      </strong>
                    </span>
                    <span>
                      PEAK:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {String(meta.elaMaxDelta ?? 'N/A')}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Dark ELA Viewport */}
                <div className="relative overflow-auto rounded-xl border border-slate-800 bg-[#0F172A] p-3">
                  <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
                    <span>+ [SPECTRAL_0]</span>
                    <span>[SPECTRAL_1] +</span>
                  </div>

                  {current.elaPath ? (
                    <div
                      className="mx-auto w-fit transition-transform duration-150"
                      style={zoomScaleStyle}
                    >
                      <img
                        src={current.elaPath}
                        alt={`Edit heatmap for ${current.filename}`}
                        className="mx-auto max-h-[430px] w-full rounded object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-[320px] items-center justify-center text-xs text-slate-400">
                      Edit heatmap unavailable for this photo format.
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
                    <span>+ [BAND_LOW]</span>
                    <span>[BAND_HIGH] +</span>
                  </div>
                </div>
              </div>

              {/* Calibrated Residual Gradient Scale */}
              <div className="mt-3 space-y-1.5">
                <div className="h-2 w-full rounded-full bg-gradient-to-r from-slate-800 via-blue-600 via-amber-400 to-rose-600" />
                <div className="flex items-center justify-between font-mono text-[10px] uppercase text-slate-500 dark:text-slate-400">
                  <span>0.0 Uniform Sensor Noise</span>
                  <span className="text-blue-700 dark:text-sky-400">Typical Compression</span>
                  <span className="text-rose-700 dark:text-rose-400">High Residual / Splice</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom 2-Column Evidence + Spectral & Crypto Signals */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Visual & Surface Evidence */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <ShieldAlert className="h-4 w-4 text-blue-700 dark:text-sky-400" />
              Visual &amp; Surface Evidence
            </h3>
            <span className="font-mono text-[11px] font-semibold uppercase text-blue-700 dark:text-sky-400">
              {findings.length} Signal Check{findings.length === 1 ? '' : 's'}
            </span>
          </div>

          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {current.technicalSummary}
          </p>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Itemized Findings ({findings.length})
            </h4>
            <div className="mt-3 space-y-2.5">
              {findings.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-[#0B1120] dark:text-slate-400">
                  No suspicious visual artifacts recorded for this image.
                </p>
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

        {/* Spectral & Metadata Signals */}
        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                <Activity className="h-4 w-4 text-blue-700 dark:text-sky-400" />
                Spectral &amp; Metadata Signals
              </h3>
              <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                Signal Primary
              </span>
            </div>

            <dl className="mt-4 divide-y divide-slate-100 text-xs dark:divide-slate-800/80">
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Size &amp; Format</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {imgWidth && imgHeight
                    ? `${imgWidth} × ${imgHeight} px · ${String(meta.format ?? '').toUpperCase()}`
                    : String(meta.format ?? current.mimeType)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">2D-FFT High-Freq Ratio</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {fft ? `${(Number(fft.highFreqEnergyRatio) * 100).toFixed(2)}%` : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">FFT Upsampling Grid Peak</dt>
                <dd className="font-mono font-semibold tabular-nums text-blue-700 dark:text-sky-400">
                  {fft ? `${fft.periodicGridPeakRatio}x` : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Noise Residual (Laplacian)</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {noise
                    ? `${noise.laplacianMean} (Uniformity ${noise.blockNoiseUniformity})`
                    : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Edit Heatmap Score</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {meta.elaMeanDelta !== undefined
                    ? `Avg ${meta.elaMeanDelta} · Peak ${meta.elaMaxDelta ?? '—'}`
                    : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">C2PA Provenance Manifest</dt>
                <dd className="font-mono text-slate-700 dark:text-slate-200">
                  {provenance?.hasC2paCredentials ? 'Present' : 'Not Embedded'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Camera EXIF (Advisory)</dt>
                <dd className="font-mono text-slate-700 dark:text-slate-200">
                  {meta.hasCameraHardwareTags
                    ? [meta.make, meta.model].filter(Boolean).join(' ')
                    : 'Not present'}
                </dd>
              </div>
              {Boolean(meta.software) && (
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-slate-500 dark:text-slate-400">Software Tag</dt>
                  <dd className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                    {String(meta.software)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">AI Generator Signatures</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200">
                  {Array.isArray(provenance?.aiGeneratorSignatures) &&
                  provenance.aiGeneratorSignatures.length > 0
                    ? provenance.aiGeneratorSignatures.join(', ')
                    : '0 Signatures Found'}
                </dd>
              </div>
            </dl>

            {/* 2D-FFT Radial Falloff Curve */}
            {spectrumSeries.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-[#0B1120]">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="font-semibold uppercase text-slate-500 dark:text-slate-400">
                    2D-FFT Radial Power Profile
                  </span>
                  <span
                    className={
                      Number(fft?.periodicGridPeakRatio ?? 0) > 2.5
                        ? 'font-semibold text-rose-700 dark:text-rose-400'
                        : 'font-semibold text-blue-700 dark:text-sky-400'
                    }
                  >
                    {Number(fft?.periodicGridPeakRatio ?? 0) > 2.5
                      ? 'Grid Peak Detected'
                      : 'Natural Falloff'}
                  </span>
                </div>
                <div className="mt-2 h-24 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={spectrumSeries}
                      margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="fftFill" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor={theme === 'dark' ? '#38BDF8' : '#1D4ED8'}
                            stopOpacity={0.28}
                          />
                          <stop
                            offset="95%"
                            stopColor={theme === 'dark' ? '#38BDF8' : '#1D4ED8'}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="band" hide />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={
                          theme === 'dark'
                            ? {
                                backgroundColor: '#0F172A',
                                borderColor: '#334155',
                                borderRadius: '6px',
                                fontSize: '11px',
                                color: '#F8FAFC',
                              }
                            : {
                                backgroundColor: '#FFFFFF',
                                borderColor: '#E2E8F0',
                                borderRadius: '6px',
                                fontSize: '11px',
                                color: '#0F172A',
                              }
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="energy"
                        stroke={theme === 'dark' ? '#38BDF8' : '#1D4ED8'}
                        strokeWidth={2}
                        fill="url(#fftFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-center font-mono text-[10px] text-slate-400 dark:text-slate-500">
                  DC Frequency → High-Frequency Radial Bands
                </p>
              </div>
            )}

            <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Metadata &amp; C2PA tags are advisory context only; missing EXIF or watermarks never classify an image as real or AI-generated.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
