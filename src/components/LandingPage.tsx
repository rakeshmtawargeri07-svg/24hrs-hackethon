import {
  ArrowRight,
  AudioLines,
  CheckCircle2,
  FileSearch,
  FileText,
  Film,
  GitCompareArrows,
  Image as ImageIcon,
  Layers,
  LogIn,
  LogOut,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function LandingPage({
  onEnterWorkspace,
}: {
  onEnterWorkspace: () => void;
}) {
  const { user, signInWithGoogle, logout, authError } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);
  const [opticalImgError, setOpticalImgError] = useState(false);
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
    <div className="flex min-h-screen flex-col bg-[#0B1120] text-[#F8FAFC]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B1120]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
          <span className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0">
            TruthLens
          </span>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <a href="#what-we-check" className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              What We Check
            </a>
            <a href="#how-it-works" className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#results-guide" className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Results &amp; Limits
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

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6">
        {/* Hero Section */}
        <section className="grid grid-cols-1 items-center gap-10 py-14 lg:grid-cols-12 lg:py-20">
          <div className="lg:col-span-6">
            <p className="text-xs font-medium tracking-wide text-sky-400">
              Media &amp; Deepfake Verification
            </p>
            <h1
              className="mt-3 font-bold tracking-tight text-slate-50"
              style={{
                fontSize: 'clamp(2.2rem, 3.8vw, 3.2rem)',
                lineHeight: 1.1,
                textWrap: 'balance',
              }}
            >
              Check photos, videos, audio, and text before you trust them.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300">
              Bring related files together in one case. TruthLens inspects camera tags, edit heatmaps, video frames, voice recordings, and captions—explaining what stands out and where checks have limits.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGetStarted}
                disabled={signingIn}
                className="inline-flex items-center gap-2.5 rounded-lg bg-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-60"
              >
                <span>
                  {user
                    ? 'Open Workspace'
                    : signingIn
                    ? 'Connecting Google...'
                    : 'Get Started'}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>

              {!user && (
                <button
                  type="button"
                  onClick={handleGetStarted}
                  disabled={signingIn}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#11192B] px-5 py-3 text-sm font-medium text-slate-200 hover:border-sky-500 hover:text-white transition-colors disabled:opacity-60"
                >
                  <LogIn className="h-4 w-4 text-sky-400" />
                  <span>Log in with Google</span>
                </button>
              )}
            </div>

            {authError && (
              <p className="mt-3 text-xs text-rose-400">{authError}</p>
            )}

            <p className="mt-6 font-mono text-xs text-slate-400">
              Supports JPG, PNG, WEBP · MP4, MOV, AVI · MP3, WAV, M4A · TXT, PDF, DOCX
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-800 bg-[#11192B]">
              {!heroImgError ? (
                <img
                  src="/src/assets/images/hero_forensics_lab_1795076459822.jpg"
                  alt="TruthLens media verification workstation"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-[#161F33]">
                  <Layers className="h-10 w-10 text-sky-400" />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* What We Check */}
        <section id="what-we-check" className="border-t border-slate-800/80 py-14 space-y-10">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-sky-400">What We Check</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-50">
              Four media checks plus cross-file comparison
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Single files only tell part of the story. TruthLens checks each file on its own and then compares them side by side for contradictions.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
              <ImageIcon className="h-5 w-5 text-sky-400" />
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Photo Check</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Reads camera details, generates an edit &amp; compression heatmap, and highlights areas that look altered or AI-generated.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
              <Film className="h-5 w-5 text-sky-400" />
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Video Check</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Extracts key moments across the timeline so you can jump directly to timestamps with unusual face, lighting, or motion shifts.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
              <AudioLines className="h-5 w-5 text-sky-400" />
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Voice &amp; Audio Check</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Builds an interactive waveform, transcribes spoken words, and screens recordings for cloned voice or splice indicators.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-5">
              <FileText className="h-5 w-5 text-sky-400" />
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Text &amp; Cross-Check</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Reads PDF, DOCX, TXT, or pasted captions to catch timeline mismatches and contradictions across your uploaded files.
              </p>
            </div>
          </div>

          {/* Visual Inspection Preview Cards */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#11192B]">
              <div className="aspect-[16/9] w-full overflow-hidden bg-[#0E1526]">
                {!opticalImgError ? (
                  <img
                    src="/src/assets/images/capability_optical_sensor_1795076459010.jpg"
                    alt="Photo and video pixel inspection"
                    referrerPolicy="no-referrer"
                    onError={() => setOpticalImgError(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-sky-400" />
                  </div>
                )}
              </div>
              <div className="p-5">
                <h3 className="text-sm font-semibold text-slate-100">
                  Visual &amp; Heatmap Inspection
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  View the original photo next to its edit heatmap, click highlighted regions to read plain-English explanations, and check whether camera tags were kept or removed.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#11192B]">
              <div className="aspect-[16/9] w-full overflow-hidden bg-[#0E1526]">
                {!audioImgError ? (
                  <img
                    src="/src/assets/images/capability_audio_console_1795076460182.jpg"
                    alt="Audio waveform and cross-file comparison"
                    referrerPolicy="no-referrer"
                    onError={() => setAudioImgError(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <AudioLines className="h-8 w-8 text-sky-400" />
                  </div>
                )}
              </div>
              <div className="p-5">
                <h3 className="text-sm font-semibold text-slate-100">
                  Audio Waveforms &amp; Cross-File Comparison
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Click any bar on the audio waveform to listen to flagged segments, read extracted speech transcripts, and compare audio, video, and captions together.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="border-t border-slate-800/80 py-14">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-sky-400">How It Works</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-50">
              From upload to clear report in three steps
            </h2>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6">
              <div className="flex items-center gap-3">
                <UploadCloud className="h-5 w-5 text-sky-400" />
                <span className="font-mono text-xs text-slate-400">Step 1</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Upload Your Files</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Create a case and drop in photos, videos, audio clips, documents, or paste a caption/transcript. Every file receives a unique SHA-256 fingerprint.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6">
              <div className="flex items-center gap-3">
                <GitCompareArrows className="h-5 w-5 text-sky-400" />
                <span className="font-mono text-xs text-slate-400">Step 2</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Run Multi-Signal Checks</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                TruthLens inspects file metadata, edit heatmaps, video frames, audio characteristics, and compares multiple files together for inconsistencies.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#11192B] p-6">
              <div className="flex items-center gap-3">
                <FileSearch className="h-5 w-5 text-sky-400" />
                <span className="font-mono text-xs text-slate-400">Step 3</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-100">Review &amp; Download PDF</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Inspect flagged regions and timestamps interactively, read plain-language explanations with limitations, and download a structured PDF report.
              </p>
            </div>
          </div>
        </section>

        {/* Results & Honest Limits */}
        <section id="results-guide" className="border-t border-slate-800/80 py-14">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <p className="text-xs font-medium text-sky-400">Results &amp; Limits</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-50">
                Designed to inform human judgment, not replace it
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Social media recompression, screenshots, and missing camera tags are common on everyday files. TruthLens never jumps to absolute &ldquo;real&rdquo; or &ldquo;fake&rdquo; labels—every finding explains what was observed, its confidence score, and what the check cannot prove.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
              <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <ShieldAlert className="h-4 w-4" />
                  <span>Suspicious</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Noticeable signs of editing, synthetic generation, or contradictions between files were observed and warrant closer review.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Looks Normal</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  No significant manipulation signs were detected in the inspected visuals, sound, or text—though heavy re-encoding can hide subtle edits.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
                <p className="text-sm font-semibold text-slate-200">Inconclusive</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Signals are mixed or weak (for example, stripped camera tags from a messaging app) and cannot point clearly either way.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#11192B] p-4">
                <p className="text-sm font-semibold text-slate-300">Analysis Unavailable</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Shown transparently when a companion file or check step could not run, rather than guessing a result.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mb-12 rounded-xl border border-slate-800 bg-[#11192B] p-8 flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">
              Ready to verify a photo, video, audio clip, or document?
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Sign in with Google to save cases, inspect files, and download PDF reports.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGetStarted}
              disabled={signingIn}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 transition-colors disabled:opacity-60"
            >
              <span>{user ? 'Open Workspace' : signingIn ? 'Signing in...' : 'Get Started'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-6">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <span>TruthLens · Multimodal Media Verification</span>
          <span>Explainable signals, file fingerprints, and human-review guidance</span>
        </div>
      </footer>
    </div>
  );
}
