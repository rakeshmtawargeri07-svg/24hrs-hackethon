import { Clock, Film } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EvidenceItem, ForensicFinding } from '../../types/forensics';
import { AiProbabilityMeter, ClassificationBadge, ExplainableFindingCard } from '../ForensicBadges';

export function VideoForensicsView({
  videos,
  onGoToUpload,
}: {
  videos: Array<EvidenceItem & { findings?: ForensicFinding[] }>;
  onGoToUpload: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(videos[0]?.id ?? null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videos.length > 0 && !videos.some((v) => v.id === selectedId)) {
      setSelectedId(videos[0].id);
    }
  }, [videos, selectedId]);

  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-[#11192B]">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">No Videos Yet</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Upload MP4, MOV, or AVI videos in a new investigation to inspect multi-frame temporal consistency, facial movement, and suspicious timestamps.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="mt-5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
        >
          Upload Videos
        </button>
      </div>
    );
  }

  const current = videos.find((v) => v.id === selectedId) ?? videos[0];
  const findings = current.findings ?? [];
  const meta = current.metadataJson ?? {};
  const detectionLabel = typeof meta.detectionLabel === 'string' ? meta.detectionLabel : undefined;
  const aiProbability = typeof meta.aiProbability === 'number' ? meta.aiProbability : null;
  const temporalSignals = (meta.temporalSignals as Record<string, any> | undefined) ?? null;
  const frameAnalysis = Array.isArray(meta.frameAnalysis)
    ? (meta.frameAnalysis as Array<{
        frameIndex: number;
        timestampSec: number;
        observation: string;
        suspicious: boolean;
      }>)
    : [];
  const provenance = (meta.provenance as Record<string, any> | undefined) ?? null;

  const keyframes = Array.isArray(meta.keyframes)
    ? (meta.keyframes as Array<{
        frameIndex: number;
        timestampSec: number;
        dataUrl: string;
      }>)
    : [];

  const seekTo = (sec?: number) => {
    if (typeof sec !== 'number' || !videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, sec);
    void videoRef.current.play().catch(() => {});
  };

  return (
    <div className="space-y-5">
      {videos.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Video File
            </label>
            <select
              value={current.id}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500"
            >
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  #{v.id} — {v.filename} ({String(v.metadataJson?.detectionLabel ?? v.classification)})
                </option>
              ))}
            </select>
          </div>

          <ClassificationBadge
            classification={current.classification}
            confidence={current.confidence}
            detectionLabel={detectionLabel}
          />
        </div>
      )}

      {/* AI Probability Bar */}
      <AiProbabilityMeter
        detectionLabel={detectionLabel}
        aiProbability={aiProbability}
        confidence={current.confidence}
      />

      {/* Player & Temporal Metrics */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-8">
          <video
            ref={videoRef}
            src={current.storagePath}
            controls
            className="max-h-[420px] w-full rounded-xl border border-slate-800 bg-[#0F172A]"
          />
          <p className="mt-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {current.technicalSummary}
          </p>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Film className="h-4 w-4 text-blue-700 dark:text-sky-400" />
              Temporal &amp; Video Signals
            </h3>
            <dl className="mt-4 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">File Format</dt>
                <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {String(meta.containerType ?? 'Unknown')}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Resolution &amp; FPS</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {Number(meta.width ?? 0)} × {Number(meta.height ?? 0)}
                  {meta.fps ? ` · ${meta.fps} fps` : ''}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Duration</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {Number(meta.durationSec ?? 0).toFixed(2)}s
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Frames Checked</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {keyframes.length}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Max Frame Pixel Jump</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {temporalSignals ? `${temporalSignals.maxMadJump}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Lighting Jitter</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {temporalSignals ? `${temporalSignals.luminanceJitter}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Spectral Variance</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {temporalSignals ? `${temporalSignals.fftRatioVariance}` : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Metadata &amp; Watermarks (Optional)
            </h3>
            <dl className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 dark:text-slate-400">C2PA Credentials</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200">
                  {provenance?.hasC2paCredentials ? 'Present' : 'Not embedded'}
                </dd>
              </div>
              <div className="flex justify-between py-2 gap-3">
                <dt className="text-slate-500 shrink-0 dark:text-slate-400">Export Software</dt>
                <dd className="truncate font-mono text-slate-800 dark:text-slate-200">
                  {Array.isArray(meta.detectedEncoderStrings) &&
                  meta.detectedEncoderStrings.length > 0
                    ? (meta.detectedEncoderStrings as string[]).join(', ')
                    : 'None detected'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Extracted Keyframes Strip */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Key Moments &amp; Frame-Level Check (Click to Jump)
          </h3>
          <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Multi-frame temporal inspection
          </span>
        </div>

        {keyframes.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Could not preview individual frames for this video format.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {keyframes.map((frame) => {
              const fa = frameAnalysis.find((a) => a.frameIndex === frame.frameIndex);
              return (
                <button
                  key={frame.frameIndex}
                  type="button"
                  onClick={() => seekTo(frame.timestampSec)}
                  className={`group overflow-hidden rounded-xl border bg-slate-50 text-left transition-colors dark:bg-[#0B1120] ${
                    fa?.suspicious
                      ? 'border-rose-300 bg-rose-50/40 hover:border-rose-500 dark:border-rose-500/40 dark:bg-rose-500/10 dark:hover:border-rose-400'
                      : 'border-slate-200 hover:border-blue-500 dark:border-slate-800 dark:hover:border-sky-400'
                  }`}
                >
                  <img
                    src={frame.dataUrl}
                    alt={`Frame ${frame.frameIndex} at ${frame.timestampSec}s`}
                    className="aspect-video w-full object-cover bg-[#0F172A]"
                  />
                  <div className="px-3 py-2">
                    <div className="flex items-center justify-between font-mono text-[11px] font-semibold tabular-nums text-slate-700 group-hover:text-blue-700 dark:text-slate-200 dark:group-hover:text-sky-300">
                      <span>Frame {frame.frameIndex + 1}</span>
                      <span>{frame.timestampSec.toFixed(2)}s</span>
                    </div>
                    {fa?.observation && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {fa.observation}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Temporal Findings */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
          <Clock className="h-4 w-4 text-blue-700 dark:text-sky-400" />
          What Was Found in the Video
        </h3>
        <div className="mt-4 space-y-3">
          {findings.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No unusual video issues found.
            </p>
          ) : (
            findings.map((f) => (
              <ExplainableFindingCard
                key={f.id}
                finding={f}
                onSelect={
                  typeof f.regionJson?.startSec === 'number'
                    ? () => seekTo(f.regionJson?.startSec)
                    : undefined
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
