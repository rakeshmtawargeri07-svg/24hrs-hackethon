import {
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  ChevronRight,
  Columns2,
  FileSearch,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  LogIn,
  LogOut,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

type DemoMode = 'photo' | 'compare' | 'video' | 'voice' | 'text';

const DEMO_TABS: Array<{ id: DemoMode; label: string; icon: typeof ImageIcon }> = [
  { id: 'photo', label: 'Photo', icon: ImageIcon },
  { id: 'compare', label: 'Compare', icon: Columns2 },
  { id: 'video', label: 'Video', icon: Film },
  { id: 'voice', label: 'Voice', icon: AudioLines },
  { id: 'text', label: 'Text', icon: FileText },
];

const WORKFLOW_STEPS = [
  {
    id: 'upload',
    step: '01',
    title: 'Upload files or paste text',
    detail:
      'Drop photos, videos, audio clips, or documents into a case—or stage a real photo next to a suspicious one.',
    icon: UploadCloud,
  },
  {
    id: 'signals',
    step: '02',
    title: 'Analyze content signals directly',
    detail:
      'Inspects 2D-FFT frequencies, pixel noise, temporal frame consistency, spectrograms, and stylometry even without metadata.',
    icon: Layers,
  },
  {
    id: 'report',
    step: '03',
    title: 'Review clear results & PDF',
    detail:
      'Explore highlighted regions, timelines, confidence scores, and honest limitations, then download a structured PDF report.',
    icon: FileSearch,
  },
];

const VERDICT_ITEMS = [
  {
    id: 'suspicious',
    label: 'Suspicious',
    tone: 'text-amber-300',
    summary: 'Clear synthetic artifacts, editing seams, or cross-file mismatches found.',
  },
  {
    id: 'normal',
    label: 'Looks Normal',
    tone: 'text-emerald-300',
    summary: 'Natural camera, motion, voice, or writing patterns with no clear manipulation.',
  },
  {
    id: 'inconclusive',
    label: 'Inconclusive',
    tone: 'text-sky-300',
    summary: 'Signals are mixed or degraded by heavy social compression; human review advised.',
  },
  {
    id: 'unavailable',
    label: 'Analysis Unavailable',
    tone: 'text-slate-300',
    summary: 'Shown transparently if a check step fails instead of guessing a score.',
  },
];

const WAVE_BARS = [24, 52, 38, 78, 64, 42, 88, 70, 32, 60, 84, 48, 36, 72, 54, 30];

export function LandingPage({
  onEnterWorkspace,
}: {
  onEnterWorkspace: () => void;
}) {
  const { user, signInWithGoogle, logout, authError } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  // Interactive preview states
  const [demoMode, setDemoMode] = useState<DemoMode>('photo');
  const [showHeatmapOverlay, setShowHeatmapOverlay] = useState(false);
  const [compareSlider, setCompareSlider] = useState(52);
  const [videoFrameIdx, setVideoFrameIdx] = useState(1);
  const [activeWaveBar, setActiveWaveBar] = useState(6);
  const [textSample, setTextSample] = useState<'human' | 'ai'>('ai');

  // Compact interactive guide states
  const [activeStep, setActiveStep] = useState(0);
  const [openVerdict, setOpenVerdict] = useState<string>('suspicious');

  // Image error fallbacks
  const [opticalImgError, setOpticalImgError] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);
  const [audioImgError, setAudioImgError] = useState(false);

  const handleGetStarted = async () => {
    if (user) {
      onEnterWorkspace();
      return;
    }
    setSigningIn(true);
    try {
      await signInWithGoogle();
      onEnterWorkspace();
    } catch {
      // authError handled in context
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-[#0B1120] text-[#F8FAFC]">
        {/* Top Bar Contract: Brand — Concise Nav — Actions */}
        <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B1120]/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-8 px-6 py-4">
            <span className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0">
              TruthLens
            </span>

            <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
              <a
                href="#preview"
                className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                Preview
              </a>
              <a
                href="#workflow"
                className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                How It Works
              </a>
              <a
                href="#verdicts"
                className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                Verdicts
              </a>
            </nav>

            <div className="flex items-center gap-3 shrink-0">
              {user ? (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#11192B] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 transition-colors whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5 text-slate-400" />
                  <span>Log out</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGetStarted}
                  disabled={signingIn}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#11192B] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-sky-500 hover:text-white transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <LogIn className="h-3.5 w-3.5 text-sky-400" />
                  <span>{signingIn ? 'Signing in...' : 'Log in'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleGetStarted}
                disabled={signingIn}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <span>{user ? 'Open Workspace' : signingIn ? 'Signing in...' : 'Get Started'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-6">
          {/* Hero + Interactive Verification Showcase */}
          <section
            id="preview"
            className="grid grid-cols-1 items-center gap-10 py-12 lg:grid-cols-12 lg:py-16"
          >
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-5"
            >
              <p className="text-xs font-medium tracking-wide text-sky-400">
                Multimodal Verification
              </p>
              <h1
                className="mt-3 font-bold tracking-tight text-slate-50"
                style={{
                  fontSize: 'clamp(2.2rem, 3.6vw, 3.15rem)',
                  lineHeight: 1.08,
                  textWrap: 'balance',
                }}
              >
                Check photos, video, voice, and text before you trust them.
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
                Inspect pixel frequencies, video frames, voice patterns, and text—or compare a suspicious photo against a real one, even without watermarks.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleGetStarted}
                  disabled={signingIn}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <span>
                    {user ? 'Open Workspace' : signingIn ? 'Connecting Google...' : 'Get Started'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>

                {!user && (
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    disabled={signingIn}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#11192B] px-5 py-3 text-sm font-medium text-slate-200 hover:border-sky-500 hover:text-white active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <LogIn className="h-4 w-4 text-sky-400" />
                    <span>Log in with Google</span>
                  </button>
                )}
              </div>

              {authError && <p className="mt-3 text-xs text-rose-400">{authError}</p>}

              <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
                <span>JPG · PNG · WEBP</span>
                <span aria-hidden="true">/</span>
                <span>MP4 · MOV</span>
                <span aria-hidden="true">/</span>
                <span>MP3 · WAV</span>
                <span aria-hidden="true">/</span>
                <span>PDF · DOCX · TXT</span>
              </div>
            </motion.div>

            {/* Interactive Animated Preview Console */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-7"
            >
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#11192B]">
                {/* Mode Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-[#0B1120] p-1">
                    {DEMO_TABS.map((tab) => {
                      const Icon = tab.icon;
                      const active = demoMode === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setDemoMode(tab.id)}
                          className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            active ? 'text-slate-950' : 'text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="landing-demo-pill"
                              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                              className="absolute inset-0 rounded-md bg-sky-500"
                            />
                          )}
                          <Icon className="relative z-10 h-3.5 w-3.5" />
                          <span className="relative z-10">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    Interactive preview
                  </span>
                </div>

                {/* Animated Viewport */}
                <div className="p-4">
                  <AnimatePresence mode="wait">
                    {demoMode === 'photo' && (
                      <motion.div
                        key="photo"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-3"
                      >
                        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120]">
                          {!opticalImgError ? (
                            <img
                              src="/src/assets/images/capability_optical_sensor_1795076459010.jpg"
                              alt="Photo inspection preview"
                              referrerPolicy="no-referrer"
                              onError={() => setOpticalImgError(true)}
                              className={`h-full w-full object-cover transition-all duration-300 ${
                                showHeatmapOverlay ? 'contrast-150 saturate-150 brightness-90' : ''
                              }`}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-[#161F33]">
                              <ImageIcon className="h-9 w-9 text-sky-400" />
                            </div>
                          )}

                          {/* Subtle animated scanner sweep (compositor transform only) */}
                          <motion.div
                            aria-hidden="true"
                            initial={{ y: '-10%' }}
                            animate={{ y: '105%' }}
                            transition={{
                              duration: 3.4,
                              repeat: Infinity,
                              ease: 'linear',
                            }}
                            className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-sky-400/20 to-transparent"
                          />

                          {/* Scrim for readable overlay controls */}
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

                          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-200">
                              {showHeatmapOverlay
                                ? 'Edit & compression residual overlay active'
                                : '2D-FFT spectrum & pixel noise inspection'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowHeatmapOverlay((v) => !v)}
                              className="rounded-md border border-slate-600 bg-[#0B1120]/90 px-3 py-1.5 text-xs font-medium text-sky-300 hover:border-sky-400 transition-colors whitespace-nowrap shrink-0"
                            >
                              {showHeatmapOverlay ? 'View Original' : 'Toggle Heatmap'}
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          <span>Checks pixels &amp; frequency domain without needing EXIF</span>
                          <span className="font-mono tabular-nums text-emerald-300">
                            Sample: Real Photo · 94% Confidence
                          </span>
                        </div>
                      </motion.div>
                    )}

                    {demoMode === 'compare' && (
                      <motion.div
                        key="compare"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-3"
                      >
                        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120]">
                          {!opticalImgError ? (
                            <img
                              src="/src/assets/images/capability_optical_sensor_1795076459010.jpg"
                              alt="Suspicious image comparison preview"
                              referrerPolicy="no-referrer"
                              onError={() => setOpticalImgError(true)}
                              className="h-full w-full object-cover contrast-125 saturate-150"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-[#161F33]">
                              <Columns2 className="h-9 w-9 text-amber-400" />
                            </div>
                          )}

                          <div
                            className="absolute inset-0 overflow-hidden"
                            style={{ clipPath: `inset(0 ${100 - compareSlider}% 0 0)` }}
                          >
                            {!heroImgError ? (
                              <img
                                src="/src/assets/images/hero_forensics_lab_1795076459822.jpg"
                                alt="Real reference comparison preview"
                                referrerPolicy="no-referrer"
                                onError={() => setHeroImgError(true)}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center bg-[#11192B]" />
                            )}
                          </div>

                          <div
                            className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400"
                            style={{ left: `${compareSlider}%` }}
                          />

                          <span className="pointer-events-none absolute left-3 top-3 rounded bg-[#0B1120]/85 px-2 py-1 text-[11px] font-medium text-emerald-300">
                            Real Reference
                          </span>
                          <span className="pointer-events-none absolute right-3 top-3 rounded bg-[#0B1120]/85 px-2 py-1 text-[11px] font-medium text-amber-300">
                            Suspicious Photo
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <ArrowLeftRight className="h-4 w-4 shrink-0 text-sky-400" />
                          <input
                            type="range"
                            min={10}
                            max={90}
                            value={compareSlider}
                            onChange={(e) => setCompareSlider(Number(e.target.value))}
                            aria-label="Comparison split slider"
                            className="w-full accent-sky-400"
                          />
                          <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap">
                            {compareSlider}%
                          </span>
                        </div>
                      </motion.div>
                    )}

                    {demoMode === 'video' && (
                      <motion.div
                        key="video"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-3"
                      >
                        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120]">
                          {!heroImgError ? (
                            <img
                              src="/src/assets/images/hero_forensics_lab_1795076459822.jpg"
                              alt="Video frame sequence check preview"
                              referrerPolicy="no-referrer"
                              onError={() => setHeroImgError(true)}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-[#161F33]">
                              <Film className="h-9 w-9 text-sky-400" />
                            </div>
                          )}
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                          <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="text-slate-200">
                              {videoFrameIdx === 0 && '00:02s — Natural face lighting & eye blink'}
                              {videoFrameIdx === 1 && '00:05s — Temporal lip-sync & motion shift flagged'}
                              {videoFrameIdx === 2 && '00:08s — Stable background shadows verified'}
                            </span>
                            <span className="font-mono tabular-nums text-amber-300">
                              Frame {videoFrameIdx + 1} / 3
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {['00:02s · Normal', '00:05s · Flagged', '00:08s · Normal'].map(
                            (label, idx) => (
                              <button
                                key={label}
                                type="button"
                                onClick={() => setVideoFrameIdx(idx)}
                                className={`rounded-md border px-2.5 py-1.5 font-mono text-[11px] tabular-nums transition-colors ${
                                  videoFrameIdx === idx
                                    ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                    : 'border-slate-800 bg-[#0B1120] text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {label}
                              </button>
                            )
                          )}
                        </div>
                      </motion.div>
                    )}

                    {demoMode === 'voice' && (
                      <motion.div
                        key="voice"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-3"
                      >
                        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120] p-4 flex flex-col justify-between">
                          {!audioImgError && (
                            <img
                              src="/src/assets/images/capability_audio_console_1795076460182.jpg"
                              alt=""
                              aria-hidden="true"
                              referrerPolicy="no-referrer"
                              onError={() => setAudioImgError(true)}
                              className="absolute inset-0 h-full w-full object-cover opacity-20"
                            />
                          )}
                          <div className="relative z-10 flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-200">
                              Click any segment to inspect spectrogram &amp; breathing cues
                            </span>
                            <span className="font-mono tabular-nums text-sky-300">
                              00:{String(activeWaveBar + 1).padStart(2, '0')}s
                            </span>
                          </div>

                          <div className="relative z-10 flex h-28 items-end gap-1.5">
                            {WAVE_BARS.map((heightPct, idx) => {
                              const isSelected = activeWaveBar === idx;
                              const isFlagged = idx >= 5 && idx <= 8;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setActiveWaveBar(idx)}
                                  aria-label={`Inspect audio segment ${idx + 1}`}
                                  className="group flex h-full flex-1 items-end"
                                >
                                  <motion.span
                                    initial={{ scaleY: 0.5 }}
                                    animate={{ scaleY: 1 }}
                                    transition={{ duration: 0.25, delay: idx * 0.015 }}
                                    style={{ height: `${heightPct}%`, transformOrigin: 'bottom' }}
                                    className={`w-full rounded-t transition-colors ${
                                      isSelected
                                        ? 'bg-sky-400'
                                        : isFlagged
                                        ? 'bg-amber-400/70 group-hover:bg-amber-300'
                                        : 'bg-slate-600/80 group-hover:bg-slate-400'
                                    }`}
                                  />
                                </button>
                              );
                            })}
                          </div>

                          <div className="relative z-10 flex items-center justify-between text-xs text-slate-300">
                            <span>
                              {activeWaveBar >= 5 && activeWaveBar <= 8
                                ? 'Uniform pitch contour & missing breath pause detected'
                                : 'Natural room noise & prosody variation observed'}
                            </span>
                            <span className="font-mono tabular-nums text-slate-400">MFCC + STFT</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {demoMode === 'text' && (
                      <motion.div
                        key="text"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-3"
                      >
                        <div className="aspect-[16/9] overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120] p-4 flex flex-col justify-between">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-200">
                              Stylometry &amp; Predictability Check
                            </span>
                            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#11192B] p-0.5">
                              {(['ai', 'human'] as const).map((kind) => (
                                <button
                                  key={kind}
                                  type="button"
                                  onClick={() => setTextSample(kind)}
                                  className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                    textSample === kind
                                      ? 'bg-sky-500 text-slate-950'
                                      : 'text-slate-400 hover:text-slate-100'
                                  }`}
                                >
                                  {kind === 'ai' ? 'AI Sample' : 'Human Sample'}
                                </button>
                              ))}
                            </div>
                          </div>

                          <p className="rounded-lg border border-slate-800 bg-[#11192B] p-3.5 text-xs leading-relaxed text-slate-300">
                            {textSample === 'ai'
                              ? '“Furthermore, the integration of emerging technologies underscores the critical importance of establishing robust governance frameworks across multifaceted global ecosystems.”'
                              : '“Honestly, the draft still feels rushed—we cut two sections before noon and left the raw field notes at the bottom so editors can check the dates.”'}
                          </p>

                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                            <span
                              className={
                                textSample === 'ai' ? 'text-amber-300 font-medium' : 'text-emerald-300 font-medium'
                              }
                            >
                              {textSample === 'ai'
                                ? 'Result: AI-Generated · Low sentence variance'
                                : 'Result: Human-Written · Natural burstiness'}
                            </span>
                            <span className="font-mono tabular-nums text-slate-400">
                              {textSample === 'ai' ? 'AI Probability: 91%' : 'AI Probability: 8%'}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </section>

          {/* Compact Interactive Workflow + Honest Verdict Guide */}
          <section
            id="workflow"
            className="border-t border-slate-800/80 py-12 grid grid-cols-1 gap-8 lg:grid-cols-12"
          >
            {/* Interactive 3-Step Workflow */}
            <div className="lg:col-span-7 space-y-4">
              <div>
                <p className="text-xs font-medium text-sky-400">How It Works</p>
                <h2 className="mt-1.5 text-xl font-bold tracking-tight text-slate-50">
                  Three steps from upload to PDF report
                </h2>
              </div>

              <div className="space-y-2.5">
                {WORKFLOW_STEPS.map((item, idx) => {
                  const Icon = item.icon;
                  const active = activeStep === idx;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveStep(idx)}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-sky-500/50 bg-[#11192B]'
                          : 'border-slate-800 bg-[#0E1526] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              active ? 'text-sky-400' : 'text-slate-500'
                            }`}
                          />
                          <span className="font-mono text-xs tabular-nums text-slate-400">
                            {item.step}
                          </span>
                          <span className="text-sm font-semibold text-slate-100">
                            {item.title}
                          </span>
                        </div>
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                            active ? 'rotate-90 text-sky-400' : 'text-slate-500'
                          }`}
                        />
                      </div>

                      <AnimatePresence initial={false}>
                        {active && (
                          <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.16 }}
                            className="mt-2.5 pl-7 text-xs leading-relaxed text-slate-400"
                          >
                            {item.detail}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Interactive Verdict Guide */}
            <div id="verdicts" className="lg:col-span-5 space-y-4">
              <div>
                <p className="text-xs font-medium text-sky-400">Transparent Verdicts</p>
                <h2 className="mt-1.5 text-xl font-bold tracking-tight text-slate-50">
                  Clear labels, honest limits
                </h2>
              </div>

              <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-[#11192B]">
                {VERDICT_ITEMS.map((v) => {
                  const isOpen = openVerdict === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setOpenVerdict(v.id)}
                      className="w-full p-4 text-left transition-colors hover:bg-slate-800/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`inline-flex items-center gap-2 text-sm font-semibold ${v.tone}`}>
                          {v.id === 'suspicious' && <ShieldAlert className="h-4 w-4" />}
                          {v.id === 'normal' && <CheckCircle2 className="h-4 w-4" />}
                          <span>{v.label}</span>
                        </span>
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                            isOpen ? 'rotate-90 text-sky-400' : 'text-slate-500'
                          }`}
                        />
                      </div>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.p
                            initial={{ opacity: 0, y: -3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.16 }}
                            className="mt-2 text-xs leading-relaxed text-slate-400"
                          >
                            {v.summary}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Compact Bottom CTA */}
          <section className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#11192B] px-6 py-5">
            <div>
              <h2 className="text-base font-semibold text-slate-50">
                Ready to verify a file or compare two photos?
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Sign in with Google to run checks, save cases, and export PDF reports.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGetStarted}
              disabled={signingIn}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 active:scale-[0.98] transition-all disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <span>{user ? 'Open Workspace' : signingIn ? 'Signing in...' : 'Get Started'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        </main>

        <footer className="border-t border-slate-800/80 py-5">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
            <span>TruthLens · Multimodal Media Verification</span>
            <span>Content-first signal analysis with transparent confidence limits</span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
