import {
  CheckSquare,
  Columns2,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, ensureServerReady } from '../../lib/api';
import {
  extractAudioFeatures,
  ExtractedAudioData,
  ExtractedVideoData,
  extractVideoKeyframes,
} from '../../lib/mediaExtractor';
import { EvidenceModality, InvestigationDetail } from '../../types/forensics';

interface StagedFile {
  id: string;
  file: File;
  modality: EvidenceModality;
  previewUrl: string | null;
  statusText: string;
  videoData?: ExtractedVideoData;
  audioData?: ExtractedAudioData | null;
}

const ACCEPTED_EXTS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.mp4',
  '.mov',
  '.avi',
  '.mp3',
  '.wav',
  '.m4a',
  '.txt',
  '.pdf',
  '.docx',
];

const ENGINE_MODULES = [
  {
    id: 'fft',
    name: '2D-FFT & Frequency Artifacts',
    desc: 'Detects synthetic upsampling grids & radial spectral anomalies',
    modalities: ['image', 'video'] as EvidenceModality[],
  },
  {
    id: 'ela',
    name: 'Error Level Analysis (ELA)',
    desc: 'Maps differential compression rates & localized splice regions',
    modalities: ['image'] as EvidenceModality[],
  },
  {
    id: 'temporal',
    name: 'Video Temporal Frame Check',
    desc: 'Evaluates keyframe luminance jitter, face consistency & pixel jumps',
    modalities: ['video'] as EvidenceModality[],
  },
  {
    id: 'audio',
    name: 'Voice Clone & Spectral MFCC',
    desc: 'Screens STFT cutoff, noise floor & synthetic formant patterns',
    modalities: ['audio'] as EvidenceModality[],
  },
  {
    id: 'stylometry',
    name: 'Linguistic & Stylometry AI',
    desc: 'Computes burstiness, lexical diversity & cross-modal claims',
    modalities: ['text', 'audio', 'video'] as EvidenceModality[],
  },
];

function detectModality(filename: string): EvidenceModality | null {
  const lower = filename.toLowerCase();
  if (/\.(jpg|jpeg|png|webp)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|avi)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a)$/.test(lower)) return 'audio';
  if (/\.(txt|pdf|docx)$/.test(lower)) return 'text';
  return null;
}

export function NewInvestigationView({
  initialFiles = [],
  onConsumedInitialFiles,
  onSwitchToCompare,
  onInvestigationCreated,
}: {
  initialFiles?: File[];
  onConsumedInitialFiles?: () => void;
  onSwitchToCompare?: () => void;
  onInvestigationCreated: (inv: InvestigationDetail) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('Standard Review');
  const [description, setDescription] = useState('');
  const [pastedTextTitle, setPastedTextTitle] = useState('accompanying-transcript.txt');
  const [pastedText, setPastedText] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!submitting) {
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [submitting]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setErrorMsg(null);
    const list = Array.from(files);

    for (const file of list) {
      const modality = detectModality(file.name);
      if (!modality) {
        setErrorMsg(
          `Unsupported format: "${file.name}". Allowed: ${ACCEPTED_EXTS.join(', ')}`
        );
        continue;
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
          // Keep original File handle if arrayBuffer read fails
        }
      }

      const id = `${safeFile.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const previewUrl =
        modality === 'image' || modality === 'video' ? URL.createObjectURL(safeFile) : null;

      const initial: StagedFile = {
        id,
        file: safeFile,
        modality,
        previewUrl,
        statusText:
          modality === 'video'
            ? 'Extracting video keyframes...'
            : modality === 'audio'
            ? 'Computing acoustic waveform...'
            : 'Ready for SHA-256 & signal analysis',
      };

      setStagedFiles((prev) => [...prev, initial]);

      if (modality === 'video') {
        const videoData = await extractVideoKeyframes(safeFile, 6);
        setStagedFiles((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  videoData,
                  statusText:
                    videoData.keyframes.length > 0
                      ? `${videoData.keyframes.length} keyframes sampled · ${videoData.durationSec.toFixed(1)}s`
                      : 'Codec preview unavailable (container metadata only)',
                }
              : s
          )
        );
      } else if (modality === 'audio') {
        const audioData = await extractAudioFeatures(safeFile);
        setStagedFiles((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  audioData,
                  statusText: audioData
                    ? `${audioData.durationSec.toFixed(1)}s · ${audioData.sampleRate} Hz · ${audioData.channels}ch`
                    : 'Audio metadata ready (browser decode unavailable)',
                }
              : s
          )
        );
      }
    }
  }, []);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      void addFiles(initialFiles);
      if (onConsumedInitialFiles) onConsumedInitialFiles();
    }
  }, [initialFiles, addFiles, onConsumedInitialFiles]);

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const clearAllStaged = () => {
    setStagedFiles((prev) => {
      for (const f of prev) {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      }
      return [];
    });
  };

  const handleClearForm = () => {
    setTitle('');
    setPriority('Standard Review');
    setDescription('');
    setPastedText('');
    setErrorMsg(null);
    clearAllStaged();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      void addFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (stagedFiles.length === 0 && !pastedText.trim()) {
      setErrorMsg('Please attach at least one evidence file or enter text/caption evidence.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    setProgressStage('Uploading evidence and computing SHA-256 hashes...');

    try {
      const formData = new FormData();
      formData.append('title', title.trim() || `Case ${new Date().toLocaleDateString()}`);
      const fullDescription = [
        priority !== 'Standard Review' ? `[Priority: ${priority}]` : '',
        description.trim(),
      ]
        .filter(Boolean)
        .join(' ');
      formData.append('description', fullDescription);
      if (pastedText.trim()) {
        formData.append('pastedTextTitle', pastedTextTitle.trim() || 'accompanying-text.txt');
        formData.append('pastedText', pastedText.trim());
      }

      const clientMetaPayload = stagedFiles.map((s) => ({
        filename: s.file.name,
        durationSec: s.videoData?.durationSec ?? s.audioData?.durationSec ?? 0,
        width: s.videoData?.width ?? 0,
        height: s.videoData?.height ?? 0,
        keyframes: s.videoData?.keyframes ?? [],
        acousticFeatures: s.audioData ?? null,
      }));
      formData.append('clientMetadata', JSON.stringify(clientMetaPayload));

      for (const item of stagedFiles) {
        formData.append('files', item.file);
      }

      setProgressStage('Connecting to analysis server...');
      const readiness = await ensureServerReady(12_000);
      if (readiness === 'auth_redirect') {
        throw new Error(
          'Your preview session expired. Please click the Reload icon (↻) at the top of the preview bar, then run your check again.'
        );
      }
      if (readiness === 'timeout') {
        throw new Error(
          'Analysis server is still waking up. Please wait a moment and click Run Forensic Analysis again.'
        );
      }

      setProgressStage('Running modality analyzers & cross-modal correlation...');
      const res = await apiFetch<{ investigation: InvestigationDetail }>(
        user,
        '/api/investigations/analyze',
        {
          method: 'POST',
          body: formData,
        }
      );

      onInvestigationCreated(res.investigation);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Analysis failed. Please verify the uploaded files and retry.');
    } finally {
      setSubmitting(false);
      setProgressStage('');
    }
  };

  const iconForModality = (m: EvidenceModality) => {
    if (m === 'image') return FileImage;
    if (m === 'video') return FileVideo;
    if (m === 'audio') return FileAudio;
    return FileText;
  };

  const activeModalities = new Set<EvidenceModality>(stagedFiles.map((f) => f.modality));
  if (pastedText.trim()) activeModalities.add('text');

  const totalItemsQueued = stagedFiles.length + (pastedText.trim() ? 1 : 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header & Intake Mode Switcher */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
            Intake Protocol · Chain of Custody Ready
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            New Forensic Investigation
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Configure case metadata, upload target media (images, video, audio, documents), or switch to dual-photo comparison.
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white dark:bg-sky-500 dark:text-slate-950">
            <Layers className="h-3.5 w-3.5" />
            <span>Multi-Modal Investigation</span>
          </span>
          {onSwitchToCompare && (
            <button
              type="button"
              onClick={onSwitchToCompare}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span>Dual Reference (Real vs. Suspicious)</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column */}
        <div className="space-y-5 lg:col-span-8">
          {/* 01 Case Identity & Priority */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 font-mono text-xs font-bold text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                  01
                </span>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Case Identity &amp; Priority
                </h2>
              </div>
              <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Chain of Custody Enabled
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="sm:col-span-8">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Case Identifier / Label
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Executive Speech & Press Clip Verification"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500 transition-colors"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Priority Classification
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:focus:border-sky-500 transition-colors"
                >
                  <option value="Standard Review">Standard Review</option>
                  <option value="High · Urgent Review">High · Urgent Review</option>
                  <option value="Archival Verification">Archival Verification</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Investigative Context &amp; Custody Notes (Optional)
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Document provenance source (e.g., social intercept, broadcast archival feed), claimed origin, or specific suspicion vectors..."
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          {/* 02 Media Ingestion Portal */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 font-mono text-xs font-bold text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                  02
                </span>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Media Ingestion Portal
                </h2>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Auto-Hash (SHA-256)
              </span>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragActive
                  ? 'border-blue-600 bg-blue-50/70 dark:border-sky-400 dark:bg-sky-500/10'
                  : 'border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/25 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-500/60'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                <UploadCloud className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Drop target evidence here, or browse system
              </p>
              <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                Supports up to 12 files · Max 60 MB per file
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                <span className="rounded border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-[#11192B]">
                  Images: JPG, PNG, WEBP
                </span>
                <span className="rounded border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-[#11192B]">
                  Video: MP4, MOV, AVI
                </span>
                <span className="rounded border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-[#11192B]">
                  Audio: WAV, MP3, M4A
                </span>
                <span className="rounded border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-[#11192B]">
                  Docs: TXT, PDF, DOCX
                </span>
              </div>
              <input
                type="file"
                multiple
                accept={ACCEPTED_EXTS.join(',')}
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>

            {/* Optional Pasted Text / Transcript */}
            <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Accompanying Transcript, Prompt, or Text (Optional AI Verification)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pastedTextTitle}
                    onChange={(e) => setPastedTextTitle(e.target.value)}
                    aria-label="Text document filename"
                    className="w-48 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200 dark:focus:border-sky-500"
                  />
                  {pastedText && (
                    <button
                      type="button"
                      onClick={() => setPastedText('')}
                      className="text-xs font-medium text-blue-700 hover:text-blue-600 dark:text-sky-400 dark:hover:text-sky-300"
                    >
                      Clear Text Buffer
                    </button>
                  )}
                </div>
              </div>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste article content, speech transcription, social post caption, or suspected LLM text to analyze stylometry and cross-check against media..."
                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          {/* Staged Forensic Targets Queue */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Staged Forensic Targets
                </h2>
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                  {totalItemsQueued} Queued
                </span>
              </div>

              {stagedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllStaged}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-300 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove All</span>
                </button>
              )}
            </div>

            {totalItemsQueued === 0 ? (
              <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-[#0B1120] dark:text-slate-400">
                No files staged yet. Drop media above or paste text to queue forensic targets.
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {stagedFiles.map((item) => {
                  const Icon = iconForModality(item.modality);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-[#0B1120]"
                    >
                      {item.modality === 'image' && item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700 dark:border-slate-800 dark:bg-[#161F33] dark:text-sky-400">
                          <Icon className="h-5 w-5" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {item.file.name}
                          </p>
                          <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                            {item.file.size >= 1024 * 1024
                              ? `${(item.file.size / (1024 * 1024)).toFixed(2)} MB`
                              : `${(item.file.size / 1024).toFixed(1)} KB`}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {item.modality.toUpperCase()} · {item.statusText}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeStagedFile(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/15 dark:hover:text-rose-300 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}

                {pastedText.trim() && (
                  <div className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-[#0B1120]">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700 dark:border-slate-800 dark:bg-[#161F33] dark:text-sky-400">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {pastedTextTitle}
                        </p>
                        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                          {pastedText.trim().length} chars
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {pastedText}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Engine Suite & Launch */}
        <div className="space-y-5 lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 font-mono text-xs font-bold text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                  03
                </span>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Active Engine Suite
                </h2>
              </div>
              <span className="font-mono text-[11px] font-semibold text-blue-700 dark:text-sky-400">
                {activeModalities.size > 0
                  ? `${
                      ENGINE_MODULES.filter((m) =>
                        m.modalities.some((mod) => activeModalities.has(mod))
                      ).length
                    }/${ENGINE_MODULES.length} Matched`
                  : `${ENGINE_MODULES.length}/${ENGINE_MODULES.length} Ready`}
              </span>
            </div>

            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              TruthLens automatically dispatches each staged asset through its signal &amp; multimodal analyzers:
            </p>

            <div className="mt-4 space-y-2.5">
              {ENGINE_MODULES.map((eng) => {
                const isEngaged =
                  activeModalities.size === 0 ||
                  eng.modalities.some((m) => activeModalities.has(m));
                return (
                  <div
                    key={eng.id}
                    className={`flex items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                      isEngaged
                        ? 'border-blue-100 bg-blue-50/40 dark:border-sky-500/30 dark:bg-sky-500/10'
                        : 'border-slate-200 bg-slate-50/60 opacity-60 dark:border-slate-800 dark:bg-[#0B1120]'
                    }`}
                  >
                    <CheckSquare
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        isEngaged ? 'text-blue-700 dark:text-sky-400' : 'text-slate-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {eng.name}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        {eng.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-[#11192B] space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-500 dark:text-slate-400">Queued Assets</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {totalItemsQueued} target(s)
              </span>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-xs hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="truncate">
                    {progressStage || 'Analyzing...'} ({elapsedSec}s)
                  </span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  <span>Run Forensic Analysis</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={handleClearForm}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              Reset Investigation Form
            </button>

            <p className="text-center text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              All uploaded evidence is hashed via SHA-256 on intake and analyzed across isolated modality pipelines.
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}
