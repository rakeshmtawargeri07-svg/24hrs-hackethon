import { AudioLines, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EvidenceItem, ForensicFinding } from '../../types/forensics';
import { AiProbabilityMeter, ClassificationBadge, ExplainableFindingCard } from '../ForensicBadges';

export function AudioForensicsView({
  audios,
  onGoToUpload,
}: {
  audios: Array<EvidenceItem & { findings?: ForensicFinding[] }>;
  onGoToUpload: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(audios[0]?.id ?? null);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audios.length > 0 && !audios.some((a) => a.id === selectedId)) {
      setSelectedId(audios[0].id);
    }
  }, [audios, selectedId]);

  if (audios.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-[#11192B] p-12 text-center">
        <h3 className="text-base font-semibold text-slate-100">No Audio Yet</h3>
        <p className="mt-2 text-sm text-slate-400">
          Upload MP3, WAV, or M4A recordings in a new check to run STFT spectrogram, 13-band MFCC, transcript, and synthetic voice detection.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="mt-5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
        >
          Upload Audio
        </button>
      </div>
    );
  }

  const current = audios.find((a) => a.id === selectedId) ?? audios[0];
  const findings = current.findings ?? [];
  const meta = current.metadataJson ?? {};
  const detectionLabel = typeof meta.detectionLabel === 'string' ? meta.detectionLabel : undefined;
  const aiProbability = typeof meta.aiProbability === 'number' ? meta.aiProbability : null;
  const provenance = (meta.provenance as Record<string, any> | undefined) ?? null;

  const peaks = Array.isArray(meta.waveformPeaks)
    ? (meta.waveformPeaks as number[])
    : Array.from({ length: 64 }, () => 0.2);

  const durationSec = Number(meta.durationSec ?? 0);
  const timedFindings = findings.filter((f) => typeof f.regionJson?.startSec === 'number');

  const seekAudio = (sec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, sec);
    void audioRef.current.play().catch(() => {});
  };

  return (
    <div className="space-y-6">
      {audios.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#11192B] p-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-400">Audio File</label>
            <select
              value={current.id}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {audios.map((a) => (
                <option key={a.id} value={a.id}>
                  #{a.id} — {a.filename} ({String(a.metadataJson?.detectionLabel ?? a.classification)})
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

      {/* Waveform Visualisation & Player */}
      <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <AudioLines className="h-4 w-4 text-sky-400" />
            Audio Waveform (Click to Jump)
          </h3>
          <span className="font-mono text-xs tabular-nums text-slate-400">
            {currentTime.toFixed(1)}s / {durationSec > 0 ? `${durationSec.toFixed(1)}s` : '—'}
          </span>
        </div>

        <div className="relative mt-4 rounded-lg border border-slate-800 bg-[#0B1120] p-4">
          <div className="relative flex h-28 items-center gap-[3px]">
            {peaks.map((peak, idx) => {
              const barTime = durationSec > 0 ? (idx / peaks.length) * durationSec : 0;
              const isFlagged = timedFindings.some((f) => {
                const start = f.regionJson?.startSec ?? -1;
                const end = f.regionJson?.endSec ?? start + 1;
                return barTime >= start && barTime <= end;
              });
              const isPlayed = durationSec > 0 && barTime <= currentTime;
              const heightPct = Math.max(8, Math.min(100, Math.round(peak * 100)));

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => durationSec > 0 && seekAudio(barTime)}
                  title={`${barTime.toFixed(1)}s`}
                  className="flex h-full flex-1 items-center justify-center group"
                >
                  <span
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-sm transition-colors ${
                      isFlagged
                        ? 'bg-amber-400'
                        : isPlayed
                        ? 'bg-sky-400'
                        : 'bg-slate-700 group-hover:bg-slate-500'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <audio
              ref={audioRef}
              src={current.storagePath}
              controls
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              className="w-full"
            />
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          {current.technicalSummary}
        </p>
      </div>

      {/* Spectrogram & MFCC Metrics + Spoken Words */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5 lg:col-span-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Volume2 className="h-4 w-4 text-sky-400" />
            Spectrogram &amp; MFCC Signals
          </h3>
          <dl className="mt-4 divide-y divide-slate-800/80 text-xs">
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">Duration &amp; Rate</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {durationSec.toFixed(2)}s
                {meta.sampleRate ? ` · ${meta.sampleRate} Hz` : ''}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">Spectral Centroid</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {meta.spectralCentroidHz ? `${meta.spectralCentroidHz} Hz` : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">Spectral Flatness</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {meta.spectralFlatness !== undefined ? String(meta.spectralFlatness) : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">High-Freq Cutoff (&gt;6kHz)</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {typeof meta.highFreqCutoffRatio === 'number'
                  ? `${(Number(meta.highFreqCutoffRatio) * 100).toFixed(1)}%`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">Noise Floor &amp; Silence</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {meta.noiseFloorDb !== undefined ? `${meta.noiseFloorDb} dB · ` : ''}
                {typeof meta.silenceRatio === 'number'
                  ? `${(Number(meta.silenceRatio) * 100).toFixed(1)}%`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">MFCC (C1–C3 Mean)</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {Array.isArray(meta.mfccMean)
                  ? (meta.mfccMean as number[]).slice(0, 3).join(', ')
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-400">AI Generator Tags (Optional)</dt>
              <dd className="text-slate-200">
                {Array.isArray(provenance?.aiGeneratorSignatures) &&
                provenance.aiGeneratorSignatures.length > 0
                  ? provenance.aiGeneratorSignatures.join(', ')
                  : 'None detected'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5 lg:col-span-7">
          <h3 className="text-sm font-semibold text-slate-100">Spoken Words (Transcript)</h3>
          <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-[#0B1120] p-4 text-sm leading-relaxed text-slate-300">
            {current.extractedText ? (
              current.extractedText
            ) : (
              <span className="text-slate-500">
                No spoken words found in this recording.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Findings */}
      <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
        <h3 className="text-sm font-semibold text-slate-100">
          What Was Found in the Audio
        </h3>
        <div className="mt-4 space-y-3">
          {findings.length === 0 ? (
            <p className="text-xs text-slate-500">No unusual audio issues found.</p>
          ) : (
            findings.map((f) => (
              <ExplainableFindingCard
                key={f.id}
                finding={f}
                onSelect={
                  typeof f.regionJson?.startSec === 'number'
                    ? () => seekAudio(f.regionJson!.startSec!)
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
