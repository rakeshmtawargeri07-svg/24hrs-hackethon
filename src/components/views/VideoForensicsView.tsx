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
      <div className="rounded-xl border border-dashed border-slate-700 bg-[#11192B] p-12 text-center">
        <h3 className="text-base font-semibold text-slate-100">No Videos Yet</h3>
        <p className="mt-2 text-sm text-slate-400">
          Upload MP4, MOV, or AVI videos in a new check to inspect multi-frame temporal consistency, facial movement, and suspicious timestamps.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="mt-5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
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
    <div className="space-y-6">
      {videos.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#11192B] p-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-400">Video File</label>
            <select
              value={current.id}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
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
        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4 lg:col-span-8">
          <video
            ref={videoRef}
            src={current.storagePath}
            controls
            className="max-h-[420px] w-full rounded-lg border border-slate-800 bg-black"
          />
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            {current.technicalSummary}
          </p>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Film className="h-4 w-4 text-sky-400" />
              Temporal &amp; Video Signals
            </h3>
            <dl className="mt-4 divide-y divide-slate-800/80 text-xs">
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">File Format</dt>
                <dd className="font-mono text-slate-200">
                  {String(meta.containerType ?? 'Unknown')}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Resolution &amp; FPS</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {Number(meta.width ?? 0)} × {Number(meta.height ?? 0)}
                  {meta.fps ? ` · ${meta.fps} fps` : ''}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Duration</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {Number(meta.durationSec ?? 0).toFixed(2)}s
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Frames Checked</dt>
                <dd className="font-mono tabular-nums text-slate-200">{keyframes.length}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Max Frame Pixel Jump</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {temporalSignals ? `${temporalSignals.maxMadJump}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Lighting Jitter</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {temporalSignals ? `${temporalSignals.luminanceJitter}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Spectral Variance</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {temporalSignals ? `${temporalSignals.fftRatioVariance}` : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
            <h3 className="text-sm font-semibold text-slate-100">
              Metadata &amp; Watermarks (Optional)
            </h3>
            <dl className="mt-3 divide-y divide-slate-800/80 text-xs">
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">C2PA Credentials</dt>
                <dd className="text-slate-200">
                  {provenance?.hasC2paCredentials ? 'Present' : 'Not embedded'}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-400">Export Software</dt>
                <dd className="font-mono text-slate-200">
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
      <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Key Moments &amp; Frame-Level Check (Click to Jump)
          </h3>
          <span className="text-xs text-slate-400">Multi-frame temporal inspection</span>
        </div>

        {keyframes.length === 0 ? (
          <p className="mt-4 text-xs text-slate-400">
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
                  className={`group overflow-hidden rounded-lg border bg-[#0B1120] text-left transition-colors ${
                    fa?.suspicious
                      ? 'border-amber-500/60 hover:border-amber-400'
                      : 'border-slate-800 hover:border-sky-400'
                  }`}
                >
                  <img
                    src={frame.dataUrl}
                    alt={`Frame ${frame.frameIndex} at ${frame.timestampSec}s`}
                    className="aspect-video w-full object-cover"
                  />
                  <div className="px-2.5 py-2">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-300 group-hover:text-sky-300">
                      <span>Frame {frame.frameIndex + 1}</span>
                      <span>{frame.timestampSec.toFixed(2)}s</span>
                    </div>
                    {fa?.observation && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">
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
      <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Clock className="h-4 w-4 text-sky-400" />
          What Was Found in the Video
        </h3>
        <div className="mt-4 space-y-3">
          {findings.length === 0 ? (
            <p className="text-xs text-slate-500">No unusual video issues found.</p>
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
