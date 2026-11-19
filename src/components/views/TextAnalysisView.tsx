import { FileText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EvidenceItem, ForensicFinding } from '../../types/forensics';
import { AiProbabilityMeter, ClassificationBadge, ExplainableFindingCard } from '../ForensicBadges';

export function TextAnalysisView({
  textItems,
  onGoToUpload,
}: {
  textItems: Array<EvidenceItem & { findings?: ForensicFinding[] }>;
  onGoToUpload: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(textItems[0]?.id ?? null);
  const [highlightExcerpt, setHighlightExcerpt] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (textItems.length > 0 && !textItems.some((t) => t.id === selectedId)) {
      setSelectedId(textItems[0].id);
    }
  }, [textItems, selectedId]);

  if (textItems.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-[#11192B]">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
          No Text or Transcripts Yet
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Upload TXT, PDF, or DOCX files—or paste text—to run stylometric, predictability, and linguistic AI text checks.
        </p>
        <button
          type="button"
          onClick={onGoToUpload}
          className="mt-5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
        >
          Upload Text
        </button>
      </div>
    );
  }

  const current = textItems.find((t) => t.id === selectedId) ?? textItems[0];
  const findings = current.findings ?? [];
  const meta = current.metadataJson ?? {};
  const detectionLabel = typeof meta.detectionLabel === 'string' ? meta.detectionLabel : undefined;
  const aiProbability = typeof meta.aiProbability === 'number' ? meta.aiProbability : null;
  const stylometry = (meta.stylometry as Record<string, any> | undefined) ?? null;

  const fullText = current.extractedText || '';
  const needle = (highlightExcerpt || searchTerm).trim();

  const renderHighlightedText = () => {
    if (!fullText) {
      return (
        <span className="text-slate-400 dark:text-slate-500">
          No readable text extracted from this source.
        </span>
      );
    }
    if (!needle) {
      return fullText;
    }
    const idx = fullText.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return fullText;
    const before = fullText.slice(0, idx);
    const match = fullText.slice(idx, idx + needle.length);
    const after = fullText.slice(idx + needle.length);
    return (
      <>
        {before}
        <mark className="rounded bg-amber-200 px-1 text-slate-900 dark:bg-amber-400/30 dark:text-amber-100">
          {match}
        </mark>
        {after}
      </>
    );
  };

  return (
    <div className="space-y-5">
      {textItems.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Text or Transcript
            </label>
            <select
              value={current.id}
              onChange={(e) => {
                setSelectedId(Number(e.target.value));
                setHighlightExcerpt('');
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500"
            >
              {textItems.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.id} — {t.filename} ({String(t.metadataJson?.detectionLabel ?? t.classification)})
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

      {(stylometry?.isShortPassage || stylometry?.lowReliabilityShortText) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Short passage note: This passage has {stylometry.wordCount} words ({stylometry.sentenceCount}{' '}
          sentence(s)). Shorter texts provide fewer statistical signals, so detection relies primarily on linguistic phrasing and template patterns.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Extracted Document Viewer */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <FileText className="h-4 w-4 text-blue-700 dark:text-sky-400" />
              Document Text
            </h3>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setHighlightExcerpt('');
                }}
                placeholder="Search excerpt..."
                className="rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500"
              />
            </div>
          </div>

          <div className="mt-4 max-h-[380px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-[#0B1120] dark:text-slate-200">
            {renderHighlightedText()}
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {current.technicalSummary}
          </p>
        </div>

        {/* Stylometry & Findings */}
        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Linguistic &amp; Stylometric Signals
            </h3>
            <dl className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Word / Sentence Count</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {String(stylometry?.wordCount ?? meta.wordCount ?? 0)} words ·{' '}
                  {String(stylometry?.sentenceCount ?? '—')} sentences
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Sentence Burstiness</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {stylometry ? `${stylometry.burstiness} (avg ${stylometry.avgSentenceLength}w)` : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Lexical Diversity (TTR)</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {stylometry ? `${stylometry.typeTokenRatio} · Hapax ${stylometry.hapaxRatio}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Phrase Repetition (2/3-gram)</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {stylometry
                    ? `${(Number(stylometry.bigramRepetitionRate) * 100).toFixed(1)}% / ${(Number(stylometry.trigramRepetitionRate) * 100).toFixed(1)}%`
                    : '—'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Source &amp; Reader</dt>
                <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {current.modality.toUpperCase()} · {String(meta.parser ?? 'Transcript')}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              What Was Found in the Text
            </h3>
            <div className="mt-3 space-y-3">
              {findings.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No unusual linguistic patterns or contradictions flagged.
                </p>
              ) : (
                findings.map((f) => (
                  <ExplainableFindingCard
                    key={f.id}
                    finding={f}
                    active={Boolean(highlightExcerpt && f.regionJson?.excerpt === highlightExcerpt)}
                    onSelect={
                      f.regionJson?.excerpt
                        ? () => setHighlightExcerpt(f.regionJson!.excerpt!)
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
