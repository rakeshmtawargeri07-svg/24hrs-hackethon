import {
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import React, { useCallback, useState } from 'react';
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

function detectModality(filename: string): EvidenceModality | null {
  const lower = filename.toLowerCase();
  if (/\.(jpg|jpeg|png|webp)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|avi)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a)$/.test(lower)) return 'audio';
  if (/\.(txt|pdf|docx)$/.test(lower)) return 'text';
  return null;
}

export function NewInvestigationView({
  onInvestigationCreated,
}: {
  onInvestigationCreated: (inv: InvestigationDetail) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pastedTextTitle, setPastedTextTitle] = useState('accompanying-transcript.txt');
  const [pastedText, setPastedText] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);

  React.useEffect(() => {
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

      // Snapshot files <= 25 MB into memory so disk/temp-cache edits never trigger ERR_UPLOAD_FILE_CHANGED
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
            : 'Ready for analysis',
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

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
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
      formData.append('description', description.trim());
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
          'Analysis server is still waking up. Please wait a moment and click Run Check again.'
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Investigation Details & Upload Dropzone */}
        <div className="space-y-5 lg:col-span-7">
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-100">
              01. Case Details
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                Case Name
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Press Clip & Quote Check"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B1120] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                What is this media about? (Optional)
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add where the files came from or what claims you want to double-check..."
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B1120] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6">
            <h3 className="text-base font-semibold text-slate-100">
              02. Upload Files
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Photos (JPG, PNG, WEBP) · Videos (MP4, MOV, AVI) · Audio (MP3, WAV, M4A) · Docs (TXT, PDF, DOCX)
            </p>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors ${
                dragActive
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-slate-700 bg-[#0B1120] hover:border-slate-500'
              }`}
            >
              <UploadCloud className="h-8 w-8 text-sky-400" />
              <p className="mt-3 text-sm font-medium text-slate-200">
                Drop files here, or click to choose files
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Up to 12 files · Max 60 MB each
              </p>
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

            {/* Optional Pasted Text, Caption, or Transcript */}
            <div className="mt-5 border-t border-slate-800 pt-5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-300">
                  Paste Text, Caption, or Transcript (Optional)
                </label>
                <input
                  type="text"
                  value={pastedTextTitle}
                  onChange={(e) => setPastedTextTitle(e.target.value)}
                  className="w-52 rounded-md border border-slate-700 bg-[#0B1120] px-2.5 py-1 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste an article, essay, post caption, or transcript to check for AI-generated writing or compare with your files..."
                className="mt-2 w-full rounded-lg border border-slate-700 bg-[#0B1120] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Right: Staged Evidence Queue & Launch */}
        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                03. Files Ready to Check
              </h3>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {stagedFiles.length + (pastedText.trim() ? 1 : 0)} file(s)
              </span>
            </div>

            {stagedFiles.length === 0 && !pastedText.trim() ? (
              <p className="mt-6 rounded-lg border border-slate-800 bg-[#0B1120] p-6 text-center text-xs text-slate-500">
                No files added yet. Add photos, videos, audio clips, or documents to start checking.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {stagedFiles.map((item) => {
                  const Icon = iconForModality(item.modality);
                  return (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-slate-800 bg-[#0B1120] p-3"
                    >
                      {item.modality === 'image' && item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="h-14 w-14 rounded-md object-cover shrink-0 border border-slate-800"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-md border border-slate-800 bg-[#161F33] shrink-0">
                          <Icon className="h-6 w-6 text-sky-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {item.file.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                          {item.modality.toUpperCase()} · {(item.file.size / 1024).toFixed(1)} KB
                        </p>
                        <p className="mt-1 text-xs text-sky-300">{item.statusText}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStagedFile(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}

                {pastedText.trim() && (
                  <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-[#0B1120] p-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-md border border-slate-800 bg-[#161F33] shrink-0">
                      <FileText className="h-6 w-6 text-sky-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{pastedTextTitle}</p>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                        TEXT · {pastedText.trim().length} chars
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-400">{pastedText}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {progressStage || 'Checking files...'} ({elapsedSec}s)
                  </span>
                </>
              ) : (
                <span>Run Check</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
