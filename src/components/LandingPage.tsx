import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Columns2,
  Copy,
  FileCheck2,
  FileText,
  Fingerprint,
  Image as ImageIcon,
  LogIn,
  LogOut,
  RotateCcw,
  UploadCloud,
} from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import React, { useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../context/ThemeContext';
import { analyzeTextStylometry } from '../services/signal/stylometry';

type ToolTab = 'precheck' | 'text' | 'compare';

const TOOL_TABS: Array<{ id: ToolTab; label: string; icon: typeof UploadCloud }> = [
  { id: 'precheck', label: 'Pre-Check File', icon: UploadCloud },
  { id: 'text', label: 'Live Text Check', icon: FileText },
  { id: 'compare', label: 'Compare Photos', icon: Columns2 },
];

const SAMPLE_AI_TEXT =
  'Furthermore, the seamless integration of emerging technologies underscores the importance of establishing robust governance frameworks. Moreover, it is worth noting that stakeholders must delve into holistic strategies across this ever-evolving landscape.';

const SAMPLE_HUMAN_TEXT =
  'Honestly, the draft still feels rushed—we cut two charts before noon because Tuesday’s camera timestamps did not match. Leave the raw notes below so Sam can check the files before 4 PM.';

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) return 'Unavailable in this browser context';
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface PrecheckInfo {
  filename: string;
  sizeLabel: string;
  mime: string;
  sha256: string;
  kind: 'image' | 'audio' | 'text' | 'other';
  dimensions?: string;
  durationSec?: number;
  waveformPeaks?: number[];
  previewUrl?: string;
  extractedPreview?: string;
}

export function LandingPage({
  onEnterWorkspace,
}: {
  onEnterWorkspace: () => void;
}) {
  const { user, signInWithGoogle, signUpWithGoogle, logout, authError } = useAuth();
  const [signingIn, setSigningIn] = useState<'signin' | 'signup' | null>(null);
  const [activeTab, setActiveTab] = useState<ToolTab>('precheck');

  // Tool 1: Real Client-Side File Pre-Check (SHA-256, dimensions, audio decode, text read)
  const [dragActive, setDragActive] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [precheck, setPrecheck] = useState<PrecheckInfo | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  // Tool 2: Real Live Text Stylometry (powered by analyzeTextStylometry)
  const [liveText, setLiveText] = useState<string>('');

  // Tool 3: Real Interactive Two-Photo Split Comparator
  const [photoA, setPhotoA] = useState<{ name: string; url: string } | null>(null);
  const [photoB, setPhotoB] = useState<{ name: string; url: string } | null>(null);
  const [splitPos, setSplitPos] = useState<number>(50);
  const [draggingSplit, setDraggingSplit] = useState<boolean>(false);
  const splitBoxRef = useRef<HTMLDivElement | null>(null);

  const stylometry = useMemo(() => analyzeTextStylometry(liveText), [liveText]);

  const handleFilePrecheck = async (file: File) => {
    setPrechecking(true);
    setCopiedHash(false);
    try {
      const buf = await file.arrayBuffer();
      const sha256 = await computeSha256Hex(buf);
      const sizeLabel =
        file.size >= 1024 * 1024
          ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
          : `${Math.max(1, Math.round(file.size / 1024))} KB`;

      if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
        const previewUrl = URL.createObjectURL(file);
        const dimensions = await new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(`${img.naturalWidth} × ${img.naturalHeight} px`);
          img.onerror = () => resolve('Dimensions unreadable');
          img.src = previewUrl;
        });
        setPrecheck((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return {
            filename: file.name,
            sizeLabel,
            mime: file.type || 'image',
            sha256,
            kind: 'image',
            dimensions,
            previewUrl,
          };
        });
      } else if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(file.name)) {
        const previewUrl = URL.createObjectURL(file);
        let durationSec = 0;
        const waveformPeaks: number[] = [];
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const decoded = await ctx.decodeAudioData(buf.slice(0));
            durationSec = Number(decoded.duration.toFixed(2));
            const chan = decoded.getChannelData(0);
            const bucket = Math.max(1, Math.floor(chan.length / 24));
            for (let i = 0; i < 24; i++) {
              let maxVal = 0;
              const start = i * bucket;
              const end = Math.min(chan.length, start + bucket);
              for (let j = start; j < end; j++) {
                const v = Math.abs(chan[j]);
                if (v > maxVal) maxVal = v;
              }
              waveformPeaks.push(Math.max(10, Math.min(100, Math.round(maxVal * 100))));
            }
            void ctx.close().catch(() => {});
          }
        } catch {
          // Audio decode failed in browser; playback element still renders
        }
        setPrecheck((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return {
            filename: file.name,
            sizeLabel,
            mime: file.type || 'audio',
            sha256,
            kind: 'audio',
            durationSec,
            waveformPeaks,
            previewUrl,
          };
        });
      } else if (
        file.type.startsWith('text/') ||
        /\.(txt|md|csv|json|log)$/i.test(file.name)
      ) {
        const text = new TextDecoder().decode(buf);
        setPrecheck((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return {
            filename: file.name,
            sizeLabel,
            mime: file.type || 'text/plain',
            sha256,
            kind: 'text',
            extractedPreview: text.slice(0, 600),
          };
        });
        setLiveText(text.slice(0, 8000));
      } else {
        setPrecheck((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return {
            filename: file.name,
            sizeLabel,
            mime: file.type || 'document/media',
            sha256,
            kind: 'other',
          };
        });
      }
    } finally {
      setPrechecking(false);
    }
  };

  const handleCompareUpload = (slot: 'a' | 'b', file: File) => {
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp)$/i.test(file.name)) return;
    const url = URL.createObjectURL(file);
    if (slot === 'a') {
      setPhotoA((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { name: file.name, url };
      });
    } else {
      setPhotoB((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { name: file.name, url };
      });
    }
  };

  const updateSplitFromPointer = (clientX: number) => {
    if (!splitBoxRef.current) return;
    const rect = splitBoxRef.current.getBoundingClientRect();
    const pct = Math.max(5, Math.min(95, Math.round(((clientX - rect.left) / rect.width) * 100)));
    setSplitPos(pct);
  };

  const handleCopyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      // clipboard denied
    }
  };

  const handleGoogleAuth = async (mode: 'signin' | 'signup') => {
    if (user) {
      onEnterWorkspace();
      return;
    }
    setSigningIn(mode);
    try {
      if (mode === 'signup') {
        await signUpWithGoogle();
      } else {
        await signInWithGoogle();
      }
      onEnterWorkspace();
    } catch {
      // authError handled in context
    } finally {
      setSigningIn(null);
    }
  };

  const renderHighlightedPhrases = () => {
    const trimmed = liveText.trim();
    if (!trimmed) {
      return (
        <span className="text-slate-400 dark:text-slate-500">
          Paste or type text above to inspect phrasing patterns, sentence variance, and word diversity in real time.
        </span>
      );
    }
    if (stylometry.aiPhraseHits.length === 0) {
      return <span>No common template transition phrases detected in this text.</span>;
    }
    const pattern = new RegExp(
      `(${stylometry.aiPhraseHits
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`,
      'gi'
    );
    return trimmed.split(pattern).map((part, idx) => {
      const hit = stylometry.aiPhraseHits.some((p) => p.toLowerCase() === part.toLowerCase());
      return hit ? (
        <mark
          key={idx}
          className="rounded bg-rose-100 px-1 font-medium text-rose-800 dark:bg-rose-500/25 dark:text-rose-200"
        >
          {part}
        </mark>
      ) : (
        <React.Fragment key={idx}>{part}</React.Fragment>
      );
    });
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-slate-900 dark:bg-[#0B1120] dark:text-slate-100 transition-colors duration-200">
        {/* Clean Navbar: TruthLens on left, Light/Dark + Google Sign-In on right */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-[#0B1120]/95">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-6 py-3.5">
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0">
              TruthLens
            </span>

            <div className="flex items-center gap-2.5 shrink-0">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => void handleGoogleAuth(user ? 'signin' : 'signup')}
                disabled={signingIn !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <span>
                  {user
                    ? 'Open Workspace'
                    : signingIn !== null
                    ? 'Connecting...'
                    : 'Sign in with Google'}
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1280px] flex-1 items-center px-6 py-10 lg:py-14">
          <section className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-12">
            {/* Hero Left: Clear Purpose + Quick Tool Selection + Google Auth */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-5 space-y-6"
            >
              <div>
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">
                  Multimodal Digital Forensics
                </p>
                <h1
                  className="mt-2.5 font-bold tracking-tight text-slate-900 dark:text-slate-50"
                  style={{
                    fontSize: 'clamp(2.25rem, 3.6vw, 3.15rem)',
                    lineHeight: 1.08,
                    textWrap: 'balance',
                  }}
                >
                  Verify photos, voice, video, and text before you trust them.
                </h1>
                <p className="mt-3.5 max-w-md text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                  Pre-check file hashes, measure live writing stylometry, or slide-compare two photos right in your browser—then sign in for 2D-FFT spectral checks, deepfake screening, and PDF reports.
                </p>
              </div>

              {/* Interactive Tool Selector Buttons */}
              <div className="flex flex-wrap gap-2">
                {TOOL_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <motion.button
                      key={tab.id}
                      type="button"
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setActiveTab(tab.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-700 text-white dark:border-sky-400 dark:bg-sky-500 dark:text-slate-950'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-800 dark:bg-[#11192B] dark:text-slate-200 dark:hover:border-sky-500/60'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tab.label}</span>
                    </motion.button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void handleGoogleAuth('signup')}
                  disabled={signingIn !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-xs hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <span>
                    {user
                      ? 'Open Workspace'
                      : signingIn === 'signup'
                      ? 'Creating Account...'
                      : 'Sign up with Google'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>

                {user ? (
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#11192B] dark:text-slate-200 dark:hover:bg-slate-800 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
                  >
                    <LogOut className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                    <span>Sign out</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleGoogleAuth('signin')}
                    disabled={signingIn !== null}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-[#11192B] dark:text-slate-200 dark:hover:border-sky-500/60 dark:hover:text-sky-300 active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <LogIn className="h-4 w-4 text-blue-700 dark:text-sky-400" />
                    <span>{signingIn === 'signin' ? 'Signing in...' : 'Sign in'}</span>
                  </button>
                )}
              </div>

              {authError && (
                <p className="text-xs font-medium text-rose-700 dark:text-rose-400">{authError}</p>
              )}
            </motion.div>

            {/* Right: Real Functional Browser Tools (No Mock Cards / No Fake Telemetry Blocks) */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-7"
            >
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#11192B]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-[#0B1120]">
                    {TOOL_TABS.map((tab) => {
                      const Icon = tab.icon;
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? 'text-white dark:text-slate-950'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="landing-tool-pill"
                              transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                              className="absolute inset-0 rounded-md bg-blue-700 dark:bg-sky-400"
                            />
                          )}
                          <Icon className="relative z-10 h-3.5 w-3.5" />
                          <span className="relative z-10">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    Runs Locally in Browser
                  </span>
                </div>

                <div className="p-5">
                  <AnimatePresence mode="wait">
                    {/* 1. REAL CLIENT-SIDE FILE PRE-CHECK & SHA-256 HASHER */}
                    {activeTab === 'precheck' && (
                      <motion.div
                        key="precheck"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                      >
                        {!precheck ? (
                          <label
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragActive(true);
                            }}
                            onDragLeave={() => setDragActive(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragActive(false);
                              const f = e.dataTransfer.files?.[0];
                              if (f) void handleFilePrecheck(f);
                            }}
                            className={`flex min-h-[290px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                              dragActive
                                ? 'border-blue-600 bg-blue-50/70 dark:border-sky-400 dark:bg-sky-500/10'
                                : 'border-slate-300 bg-slate-50 hover:border-blue-400 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-500/60'
                            }`}
                          >
                            <motion.div
                              animate={{
                                scale: dragActive ? 1.08 : [1, 1.04, 1],
                                y: dragActive ? -4 : 0,
                              }}
                              transition={
                                dragActive
                                  ? { duration: 0.2 }
                                  : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
                              }
                              className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400"
                            >
                              <UploadCloud className="h-7 w-7" />
                            </motion.div>

                            <p className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
                              {prechecking
                                ? 'Hashing & reading file...'
                                : 'Drop any photo, audio, video, or text file'}
                            </p>
                            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                              Instantly generates a cryptographic SHA-256 fingerprint, verifies resolution or audio duration, and previews decoded media before uploading.
                            </p>

                            <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white dark:bg-sky-500 dark:text-slate-950">
                              Choose File from Device
                            </span>
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp,.gif,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.txt,.md,.csv,.pdf,.docx"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void handleFilePrecheck(f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-[#0B1120]">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-sky-500/15 dark:text-sky-400">
                                  <FileCheck2 className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                                    {precheck.filename}
                                  </p>
                                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                    {precheck.sizeLabel} · {precheck.mime}
                                    {precheck.dimensions ? ` · ${precheck.dimensions}` : ''}
                                    {precheck.durationSec ? ` · ${precheck.durationSec}s` : ''}
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => setPrecheck(null)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#11192B] dark:text-slate-300 shrink-0"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Reset</span>
                              </button>
                            </div>

                            {/* Real SHA-256 Digest with Copy */}
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-[#0B1120]">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase text-slate-400">
                                  <Fingerprint className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400" />
                                  <span>SHA-256 Integrity Digest</span>
                                </div>
                                <p className="mt-0.5 truncate font-mono text-xs text-slate-800 dark:text-slate-200">
                                  {precheck.sha256}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleCopyHash(precheck.sha256)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#11192B] dark:text-slate-200 shrink-0"
                              >
                                {copiedHash ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {precheck.kind === 'image' && precheck.previewUrl && (
                              <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#0F172A] dark:border-slate-800">
                                <img
                                  src={precheck.previewUrl}
                                  alt={precheck.filename}
                                  className="mx-auto max-h-48 w-full object-contain"
                                />
                              </div>
                            )}

                            {precheck.kind === 'audio' && precheck.previewUrl && (
                              <div className="space-y-3 rounded-xl border border-slate-800 bg-[#0F172A] p-4">
                                {precheck.waveformPeaks && precheck.waveformPeaks.length > 0 && (
                                  <div className="flex h-16 items-end gap-1.5">
                                    {precheck.waveformPeaks.map((p, idx) => (
                                      <motion.span
                                        key={idx}
                                        initial={{ scaleY: 0 }}
                                        animate={{ scaleY: 1 }}
                                        transition={{ duration: 0.25, delay: idx * 0.02 }}
                                        style={{ height: `${p}%`, transformOrigin: 'bottom' }}
                                        className="flex-1 rounded-t bg-sky-400"
                                      />
                                    ))}
                                  </div>
                                )}
                                <audio src={precheck.previewUrl} controls className="w-full" />
                              </div>
                            )}

                            {precheck.kind === 'text' && precheck.extractedPreview && (
                              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-[#0B1120]">
                                <span className="text-slate-600 dark:text-slate-300">
                                  Loaded text into the Live Stylometry tab.
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('text')}
                                  className="font-semibold text-blue-700 hover:underline dark:text-sky-400"
                                >
                                  Inspect Stylometry →
                                </button>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleGoogleAuth(user ? 'signin' : 'signup')}
                              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-600 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 transition-colors"
                            >
                              <span>
                                {user
                                  ? 'Open Workspace for Full Server Scan & PDF'
                                  : 'Sign in with Google to Run Full Forensic Scan & PDF'}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* 2. REAL LIVE TEXT STYLOMETRY (USING TRUTH-LENS'S ACTUAL ENGINE) */}
                    {activeTab === 'text' && (
                      <motion.div
                        key="text"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Paste or type any paragraph to measure real stylometry
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setLiveText(SAMPLE_AI_TEXT)}
                              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200"
                            >
                              Try Formal AI Sample
                            </button>
                            <button
                              type="button"
                              onClick={() => setLiveText(SAMPLE_HUMAN_TEXT)}
                              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-200"
                            >
                              Try Human Notes
                            </button>
                            {liveText && (
                              <button
                                type="button"
                                onClick={() => setLiveText('')}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-[#11192B] dark:text-slate-400"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>

                        <textarea
                          rows={4}
                          value={liveText}
                          onChange={(e) => setLiveText(e.target.value)}
                          placeholder="Paste an email, article, or transcript here to compute sentence burstiness, type-token ratio, and template triggers..."
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-[#0B1120] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
                        />

                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono text-xs">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-[#0B1120]">
                            <div className="text-[10px] uppercase text-slate-400">Words / Sent</div>
                            <div className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-slate-100">
                              {stylometry.wordCount} / {stylometry.sentenceCount}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-[#0B1120]">
                            <div className="text-[10px] uppercase text-slate-400">Burstiness</div>
                            <div className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-slate-100">
                              {stylometry.burstiness}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-[#0B1120]">
                            <div className="text-[10px] uppercase text-slate-400">Diversity (TTR)</div>
                            <div className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-slate-100">
                              {stylometry.typeTokenRatio}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-[#0B1120]">
                            <div className="text-[10px] uppercase text-slate-400">AI Clichés</div>
                            <div
                              className={`mt-0.5 font-bold tabular-nums ${
                                stylometry.aiPhraseHits.length > 0
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-blue-700 dark:text-sky-400'
                              }`}
                            >
                              {stylometry.aiPhraseHits.length} hit(s)
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-[#0B1120] dark:text-slate-300">
                          {renderHighlightedPhrases()}
                        </div>

                        {liveText.trim() && stylometry.isShortPassage && (
                          <p className="text-[11px] text-amber-800 dark:text-amber-300">
                            Honest limit: Passages under 60 words or 3 sentences have limited statistical weight; full model review in the workspace combines stylometry with linguistic context.
                          </p>
                        )}
                      </motion.div>
                    )}

                    {/* 3. REAL TWO-PHOTO SPLIT COMPARATOR (USER'S OWN PHOTOS) */}
                    {activeTab === 'compare' && (
                      <motion.div
                        key="compare"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs hover:border-blue-500 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-400 transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <ImageIcon className="h-4 w-4 text-blue-700 dark:text-sky-400 shrink-0" />
                              <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                {photoA ? photoA.name : 'Pick Photo A (Original)'}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-blue-700 dark:text-sky-400 shrink-0">
                              Browse
                            </span>
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleCompareUpload('a', f);
                                e.target.value = '';
                              }}
                            />
                          </label>

                          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs hover:border-blue-500 dark:border-slate-700 dark:bg-[#0B1120] dark:hover:border-sky-400 transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <ImageIcon className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                              <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                {photoB ? photoB.name : 'Pick Photo B (Suspect)'}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-blue-700 dark:text-sky-400 shrink-0">
                              Browse
                            </span>
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleCompareUpload('b', f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>

                        {photoA && photoB ? (
                          <div className="space-y-3">
                            <div
                              ref={splitBoxRef}
                              onPointerDown={(e) => {
                                setDraggingSplit(true);
                                updateSplitFromPointer(e.clientX);
                              }}
                              onPointerMove={(e) => {
                                if (draggingSplit) updateSplitFromPointer(e.clientX);
                              }}
                              onPointerUp={() => setDraggingSplit(false)}
                              onPointerLeave={() => setDraggingSplit(false)}
                              className="relative aspect-[16/9] overflow-hidden rounded-xl border border-slate-800 bg-[#0F172A] cursor-ew-resize select-none touch-none"
                            >
                              <img
                                src={photoB.url}
                                alt={photoB.name}
                                className="h-full w-full object-contain pointer-events-none"
                              />
                              <div
                                className="absolute inset-0 overflow-hidden pointer-events-none"
                                style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
                              >
                                <img
                                  src={photoA.url}
                                  alt={photoA.name}
                                  className="h-full w-full object-contain"
                                />
                              </div>

                              <div
                                className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400"
                                style={{ left: `${splitPos}%` }}
                              >
                                <motion.div
                                  animate={{ scale: draggingSplit ? 1.15 : 1 }}
                                  className="absolute top-1/2 -left-4 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-sky-300 bg-slate-950/90 text-sky-300 shadow-lg"
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                </motion.div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                              <span className="whitespace-nowrap">Drag image or slider</span>
                              <input
                                type="range"
                                min={5}
                                max={95}
                                value={splitPos}
                                onChange={(e) => setSplitPos(Number(e.target.value))}
                                className="w-full accent-blue-700 dark:accent-sky-400"
                              />
                              <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
                                {splitPos}%
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex min-h-[210px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-[#0B1120]">
                            <Columns2 className="h-7 w-7 text-blue-700 dark:text-sky-400" />
                            <p className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                              Select two local photos above to compare them side-by-side
                            </p>
                            <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
                              Once selected, drag the interactive split divider across both images directly in your browser.
                            </p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </section>
        </main>

        <footer className="border-t border-slate-200 bg-white py-4 dark:border-slate-800 dark:bg-[#0B1120]">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              TruthLens · Multimodal Digital Forensics
            </span>
            <span>Client-side SHA-256 pre-checks · Full server forensics &amp; PDF export in workspace</span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
