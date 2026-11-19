import { ThinkingLevel, Type } from '@google/genai';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { ForensicClassification } from '../../db/schema.ts';
import {
  GEMINI_FAST_MODEL,
  GEMINI_MODEL,
  formatGeminiError,
  getGeminiClient,
  parseGeminiJson,
  withRetry,
} from '../geminiClient.ts';
import { AudioSpectralMfccMetrics, extractAudioSpectralAndMfcc } from '../signal/fft.ts';
import { scanBufferProvenance } from '../signal/provenanceScanner.ts';
import { AnalyzedFinding } from './imageForensics.ts';

const execFileAsync = promisify(execFile);

export interface AudioAcousticFeatures {
  durationSec: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: number[];
  rmsMean: number;
  rmsVariance: number;
  zeroCrossingRate: number;
  silenceRatio: number;
  abruptTransitions: Array<{ timestampSec: number; deltaRatio: number }>;
}

export type AudioDetectionLabel =
  | 'REAL / HUMAN VOICE'
  | 'AI-GENERATED / SYNTHETIC'
  | 'INCONCLUSIVE';

export interface AudioForensicResult {
  classification: ForensicClassification;
  detectionLabel: AudioDetectionLabel;
  aiProbability: number;
  confidence: number;
  technicalSummary: string;
  transcript: string;
  metadata: Record<string, unknown>;
  findings: AnalyzedFinding[];
}

function normalizeAudioMimeType(mimeType: string, filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp3') || mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') {
    return 'audio/mp3';
  }
  if (lower.endsWith('.wav') || mimeType.includes('wav')) {
    return 'audio/wav';
  }
  if (
    lower.endsWith('.m4a') ||
    mimeType.includes('mp4') ||
    mimeType.includes('m4a') ||
    mimeType.includes('aac')
  ) {
    return 'audio/mp4';
  }
  return mimeType || 'audio/mpeg';
}

async function computeServerSpectralMfcc(
  buffer: Buffer,
  filename: string
): Promise<AudioSpectralMfccMetrics | null> {
  if (!fs.existsSync('/usr/bin/ffmpeg')) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-aud-'));
  const ext = path.extname(filename) || '.mp3';
  const inputPath = path.join(tmpDir, `in-${crypto.randomUUID().slice(0, 8)}${ext}`);
  const pcmPath = path.join(tmpDir, 'out.f32');

  try {
    fs.writeFileSync(inputPath, buffer);
    await execFileAsync(
      '/usr/bin/ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        'f32le',
        '-acodec',
        'pcm_f32le',
        pcmPath,
      ],
      { timeout: 15000 }
    );
    if (!fs.existsSync(pcmPath)) return null;
    const raw = fs.readFileSync(pcmPath);
    const sampleCount = Math.floor(raw.byteLength / 4);
    if (sampleCount < 512) return null;
    const samples = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      sampleCount
    );
    return extractAudioSpectralAndMfcc(samples, 16000);
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function analyzeAudioEvidence(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  acousticFeatures?: AudioAcousticFeatures | null;
  caseDescription?: string;
}): Promise<AudioForensicResult> {
  const { buffer, filename, mimeType, acousticFeatures, caseDescription } = params;
  const normalizedMime = normalizeAudioMimeType(mimeType, filename);

  // Server-side FFmpeg 16kHz PCM decode -> STFT Spectrogram + 13 MFCCs
  const serverSpectral = await computeServerSpectralMfcc(buffer, filename);
  const provenance = scanBufferProvenance(buffer);

  const deterministicFindings: AnalyzedFinding[] = [];
  const mergedFeatures = {
    ...(acousticFeatures ?? {}),
    ...(serverSpectral
      ? {
          durationSec: serverSpectral.durationSec || acousticFeatures?.durationSec || 0,
          sampleRate: acousticFeatures?.sampleRate || serverSpectral.sampleRate,
          channels: acousticFeatures?.channels || 1,
          waveformPeaks:
            acousticFeatures?.waveformPeaks?.length
              ? acousticFeatures.waveformPeaks
              : serverSpectral.waveformPeaks,
          rmsMean: serverSpectral.rmsMean,
          rmsVariance: serverSpectral.rmsVariance,
          zeroCrossingRate: serverSpectral.zeroCrossingRate,
          silenceRatio: serverSpectral.silenceRatio,
          noiseFloorDb: serverSpectral.noiseFloorDb,
          spectralCentroidHz: serverSpectral.spectralCentroidHz,
          spectralFlatness: serverSpectral.spectralFlatness,
          highFreqCutoffRatio: serverSpectral.highFreqCutoffRatio,
          mfccMean: serverSpectral.mfccMean,
          mfccStd: serverSpectral.mfccStd,
          spectralFluxSpikes: serverSpectral.spectralFluxSpikes,
          abruptTransitions:
            serverSpectral.abruptTransitions.length > 0
              ? serverSpectral.abruptTransitions
              : acousticFeatures?.abruptTransitions ?? [],
        }
      : {}),
  };

  const metadata: Record<string, unknown> = {
    filename,
    mimeType: normalizedMime,
    fileSizeBytes: buffer.length,
    ...mergedFeatures,
    provenance,
  };

  if (serverSpectral) {
    if (serverSpectral.spectralFluxSpikes.length > 0) {
      const first = serverSpectral.spectralFluxSpikes[0];
      deterministicFindings.push({
        whatDetected: `Abrupt spectral flux jump (${serverSpectral.spectralFluxSpikes.length} segment(s))`,
        whereDetected: `Around ${first.timestampSec.toFixed(2)}s`,
        whyFlagged: `STFT spectral flux spiked ${first.fluxRatio}x above median, which can happen when synthesized clips are spliced or vocoder frames reset.`,
        analysisMethod: 'STFT Spectrogram & Spectral Flux Analyzer',
        confidence: 62,
        limitations:
          'Hard plosive consonants, sudden background noises, or natural mic cuts can also produce spectral flux spikes.',
        classification: 'Inconclusive',
        regionJson: {
          startSec: Math.max(0, first.timestampSec - 0.5),
          endSec: first.timestampSec + 0.5,
        },
      });
    }

    if (serverSpectral.silenceRatio > 0.45 && serverSpectral.noiseFloorDb < -62) {
      deterministicFindings.push({
        whatDetected: 'Near-zero digital silence between phrases',
        whereDetected: `Across ${(serverSpectral.silenceRatio * 100).toFixed(1)}% of audio timeline`,
        whyFlagged: `Measured noise floor drops to ${serverSpectral.noiseFloorDb} dB in silent gaps; unedited room recordings usually retain subtle ambient noise.`,
        analysisMethod: 'Noise-Floor & Breathing Interval Profiler',
        confidence: 55,
        limitations:
          'Studio noise gates, podcast filters, or aggressive denoiser plugins create similar digital silence floors.',
        classification: 'Inconclusive',
        regionJson: null,
      });
    }
  }

  if (provenance.hasWatermarkMarkers) {
    deterministicFindings.push({
      whatDetected: `Optional TTS/audio generator tag found (${provenance.aiGeneratorSignatures.join(', ')})`,
      whereDetected: 'Optional Audio File Header',
      whyFlagged: `Optional header scan noted ${provenance.provenanceSummary}`,
      analysisMethod: 'Optional C2PA / Audio Header Scanner',
      confidence: 88,
      limitations:
        'Header metadata is advisory only; spectrogram and speech content analysis remain primary.',
      classification: 'Suspicious',
      regionJson: null,
    });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary:
        'STFT spectrogram and 13-band MFCC acoustic metrics were extracted, while AI voice & transcription analysis is unavailable because GEMINI_API_KEY is not configured.',
      transcript: '',
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'AI speech & voice cloning analyzer unavailable',
          whereDetected: 'Server AI Audio Pipeline',
          whyFlagged: 'GEMINI_API_KEY is missing or unconfigured.',
          analysisMethod: 'Multimodal Audio & Prosody Analyzer',
          confidence: 0,
          limitations: 'Configure GEMINI_API_KEY in Secrets to enable synthetic speech screening.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }

  if (buffer.length > 18 * 1024 * 1024) {
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary:
        'Audio file exceeds the 18 MB inline analysis limit; STFT and MFCC acoustic metrics were extracted, but full voice screening could not run.',
      transcript: '',
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'Audio file size exceeded 18 MB inline payload limit',
          whereDetected: 'Server Audio Ingestion Layer',
          whyFlagged: `File size (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) exceeds inline model threshold.`,
          analysisMethod: 'Payload Size Guard',
          confidence: 0,
          limitations: 'Trim or compress the audio below 18 MB for full acoustic analysis.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }

  try {
    const promptText = `Analyze the ACTUAL AUDIO CONTENT, speech acoustics, and extracted spectrogram/MFCC metrics of "${filename}" to determine whether this is REAL / HUMAN VOICE, AI-GENERATED / SYNTHETIC, or INCONCLUSIVE.
${caseDescription ? `Context notes: "${caseDescription}"\n` : ''}
Measured STFT Spectrogram & 13-Band MFCC Metrics:
${JSON.stringify({
  durationSec: mergedFeatures.durationSec,
  sampleRate: mergedFeatures.sampleRate,
  noiseFloorDb: (mergedFeatures as any).noiseFloorDb,
  spectralCentroidHz: (mergedFeatures as any).spectralCentroidHz,
  spectralFlatness: (mergedFeatures as any).spectralFlatness,
  highFreqCutoffRatio: (mergedFeatures as any).highFreqCutoffRatio,
  silenceRatio: (mergedFeatures as any).silenceRatio,
  mfccMean: (mergedFeatures as any).mfccMean,
  mfccStd: (mergedFeatures as any).mfccStd,
  spectralFluxSpikes: (mergedFeatures as any).spectralFluxSpikes,
})}
Optional provenance context (advisory only): ${provenance.provenanceSummary}

Tasks:
1. Transcribe spoken dialogue verbatim in "transcript" (or "[Non-speech / ambient audio]" if no speech).
2. Inspect audio content for synthetic speech / voice cloning signs: vocoder shimmer/buzz, overly uniform pitch or prosody, absent natural breath sounds, abrupt room-tone shifts, or high-frequency spectral cutoff artifacts.
3. NEVER classify audio as human or synthetic solely because metadata/watermarks are missing.
4. Set "detectionLabel" to one of: "REAL / HUMAN VOICE", "AI-GENERATED / SYNTHETIC", or "INCONCLUSIVE".
5. Set "aiProbability" (0-100) and calibrated "confidence" (0-100).
6. Provide timestamped findings (startSec, endSec) for suspicious audio segments and write "technicalSummary" in 2-3 plain-English sentences.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        detectionLabel: { type: Type.STRING },
        aiProbability: { type: Type.INTEGER },
        confidence: { type: Type.INTEGER },
        technicalSummary: { type: Type.STRING },
        transcript: { type: Type.STRING },
        findings: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              whatDetected: { type: Type.STRING },
              whereDetected: { type: Type.STRING },
              whyFlagged: { type: Type.STRING },
              confidence: { type: Type.INTEGER },
              limitations: { type: Type.STRING },
              classification: { type: Type.STRING },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
            },
          },
        },
      },
    };

    const audioParts = [
      {
        inlineData: {
          mimeType: normalizedMime,
          data: buffer.toString('base64'),
        },
      },
      { text: promptText },
    ];
    const sysPrompt =
      'You are a fast, accurate audio forensics engineer screening recordings for TTS, voice cloning, and splicing using acoustic, prosody, breathing, background noise, and MFCC/spectrogram evidence. Never guess when signal quality is too poor—return INCONCLUSIVE.';

    let usedModel = GEMINI_FAST_MODEL;
    let response;
    try {
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_MODEL,
            contents: { parts: audioParts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 0, timeoutMs: 18_000, label: 'Fast audio check' }
      );
    } catch {
      usedModel = GEMINI_MODEL;
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: { parts: audioParts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 1, timeoutMs: 25_000, label: 'Audio check' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const rawLabel = String(parsed.detectionLabel || '').toUpperCase();
    let detectionLabel: AudioDetectionLabel =
      rawLabel.includes('AI-GENERATED') || rawLabel.includes('SYNTHETIC')
        ? 'AI-GENERATED / SYNTHETIC'
        : rawLabel.includes('REAL') || rawLabel.includes('HUMAN')
        ? 'REAL / HUMAN VOICE'
        : 'INCONCLUSIVE';

    if (provenance.hasWatermarkMarkers && detectionLabel === 'INCONCLUSIVE') {
      detectionLabel = 'AI-GENERATED / SYNTHETIC';
    }

    const aiProbability = Math.max(0, Math.min(100, Math.round(Number(parsed.aiProbability ?? 50))));
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 55))));

    const classification: ForensicClassification =
      detectionLabel === 'AI-GENERATED / SYNTHETIC'
        ? 'Suspicious'
        : detectionLabel === 'REAL / HUMAN VOICE'
        ? 'No Significant Indicators Detected'
        : 'Inconclusive';

    const validClassifications: ForensicClassification[] = [
      'Suspicious',
      'No Significant Indicators Detected',
      'Inconclusive',
      'Analysis Unavailable',
    ];

    const aiFindings: AnalyzedFinding[] = Array.isArray(parsed.findings)
      ? parsed.findings.map((f: any) => ({
          whatDetected: String(f.whatDetected || 'Acoustic speech observation'),
          whereDetected: String(
            f.whereDetected ||
              (typeof f.startSec === 'number'
                ? `${f.startSec.toFixed(1)}s - ${Number(f.endSec ?? f.startSec + 1).toFixed(1)}s`
                : 'Audio stream')
          ),
          whyFlagged: String(f.whyFlagged || 'Acoustic or prosody cue observed in speech.'),
          analysisMethod: `STFT + 13-Band MFCC + Prosody Screening (${usedModel})`,
          confidence: Math.max(0, Math.min(100, Number(f.confidence ?? confidence))),
          limitations: String(
            f.limitations ||
              'Heavy lossy compression, noisy environments, or voice filters can mask subtle vocoder artifacts.'
          ),
          classification: validClassifications.includes(f.classification)
            ? f.classification
            : classification,
          regionJson:
            typeof f.startSec === 'number'
              ? {
                  startSec: f.startSec,
                  endSec: typeof f.endSec === 'number' ? f.endSec : f.startSec + 1.5,
                }
              : null,
        }))
      : [];

    return {
      classification,
      detectionLabel,
      aiProbability,
      confidence,
      technicalSummary: String(
        parsed.technicalSummary || 'Spectrogram, MFCC, and voice forensics completed.'
      ),
      transcript: String(parsed.transcript || ''),
      metadata: {
        ...metadata,
        detectionLabel,
        aiProbability,
      },
      findings: [...aiFindings, ...deterministicFindings],
    };
  } catch (error) {
    const errMsg = formatGeminiError(error);
    if (provenance.hasWatermarkMarkers) {
      return {
        classification: 'Suspicious',
        detectionLabel: 'AI-GENERATED / SYNTHETIC',
        aiProbability: 88,
        confidence: 78,
        technicalSummary: `Spectrogram and MFCC metrics extracted, and embedded AI audio provenance markers were detected (${provenance.aiGeneratorSignatures.join(', ')}). AI speech screening timed out (${errMsg}).`,
        transcript: '',
        metadata: {
          ...metadata,
          detectionLabel: 'AI-GENERATED / SYNTHETIC',
          aiProbability: 88,
        },
        findings: [
          ...deterministicFindings,
          {
            whatDetected: 'AI speech reasoning timed out (confirmed provenance marker present)',
            whereDetected: 'Audio Analysis Pipeline',
            whyFlagged: errMsg,
            analysisMethod: 'MFCC/STFT + Optional Header Fallback',
            confidence: 78,
            limitations: 'Speech content screening timed out; verdict reflects confirmed synthetic audio metadata.',
            classification: 'Suspicious',
            regionJson: null,
          },
        ],
      };
    }
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary: `Spectrogram and MFCC metrics extracted, while AI speech screening failed: ${errMsg}`,
      transcript: '',
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'AI speech & cloning analyzer unavailable',
          whereDetected: 'Audio Analysis Pipeline',
          whyFlagged: errMsg,
          analysisMethod: 'Multimodal Audio Analyzer',
          confidence: 0,
          limitations: 'Upstream model failure prevented speech classification.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }
}
