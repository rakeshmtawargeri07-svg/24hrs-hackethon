import { ThinkingLevel, Type } from '@google/genai';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
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
import { analyzeImageSpectrum } from '../signal/fft.ts';
import { scanBufferProvenance } from '../signal/provenanceScanner.ts';
import { AnalyzedFinding } from './imageForensics.ts';

const execFileAsync = promisify(execFile);

export interface VideoKeyframeInput {
  timestampSec: number;
  dataUrl: string; // data:image/jpeg;base64,...
}

export type VideoDetectionLabel = 'REAL' | 'AI-GENERATED / MANIPULATED' | 'INCONCLUSIVE';

export interface VideoFrameMetric {
  frameIndex: number;
  timestampSec: number;
  meanLuminance: number;
  madFromPrev: number; // Mean Absolute Difference vs previous frame
  fftHighFreqRatio: number;
}

export interface VideoForensicResult {
  classification: ForensicClassification;
  detectionLabel: VideoDetectionLabel;
  aiProbability: number;
  confidence: number;
  technicalSummary: string;
  metadata: Record<string, unknown>;
  findings: AnalyzedFinding[];
}

function inspectVideoContainerHeader(buffer: Buffer, filename: string, mimeType: string) {
  const headAscii = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const tailAscii = buffer.subarray(Math.max(0, buffer.length - 4096)).toString('latin1');
  const combined = headAscii + '\n' + tailAscii;

  const encoderHints: string[] = [];
  const knownEncoders = [
    'Lavf',
    'HandBrake',
    'Adobe',
    'Premiere',
    'CapCut',
    'Runway',
    'Sora',
    'Kling',
    'FFmpeg',
    'Apple',
  ];
  for (const marker of knownEncoders) {
    if (combined.includes(marker)) {
      encoderHints.push(marker);
    }
  }

  const hasFtyp = headAscii.includes('ftyp');
  const hasRiffAvi = headAscii.startsWith('RIFF') && headAscii.includes('AVI');

  return {
    filename,
    mimeType,
    containerValid: hasFtyp || hasRiffAvi,
    containerType: hasFtyp
      ? 'ISO Base Media (MP4/MOV)'
      : hasRiffAvi
      ? 'RIFF AVI'
      : 'Unknown/Unverified',
    detectedEncoderStrings: encoderHints,
  };
}

async function extractKeyframesWithFfmpeg(
  buffer: Buffer,
  filename: string
): Promise<{
  durationSec: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudioStream: boolean;
  codecName: string | null;
  keyframes: VideoKeyframeInput[];
} | null> {
  if (!fs.existsSync('/usr/bin/ffmpeg')) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-vid-'));
  const ext = path.extname(filename) || '.mp4';
  const inputPath = path.join(tmpDir, `input-${crypto.randomUUID().slice(0, 8)}${ext}`);

  try {
    fs.writeFileSync(inputPath, buffer);

    let durationSec = 0;
    let width = 0;
    let height = 0;
    let fps: number | null = null;
    let hasAudioStream = false;
    let codecName: string | null = null;

    if (fs.existsSync('/usr/bin/ffprobe')) {
      try {
        const { stdout } = await execFileAsync(
          '/usr/bin/ffprobe',
          [
            '-v',
            'quiet',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            inputPath,
          ],
          { timeout: 10000 }
        );
        const probe = JSON.parse(stdout || '{}');
        durationSec = Number(probe?.format?.duration ?? 0) || 0;
        const streams = Array.isArray(probe?.streams) ? probe.streams : [];
        const vStream = streams.find((s: any) => s.codec_type === 'video');
        const aStream = streams.find((s: any) => s.codec_type === 'audio');
        if (vStream) {
          width = Number(vStream.width ?? 0);
          height = Number(vStream.height ?? 0);
          codecName = vStream.codec_name ? String(vStream.codec_name) : null;
          if (!durationSec && vStream.duration) durationSec = Number(vStream.duration) || 0;
          if (typeof vStream.r_frame_rate === 'string' && vStream.r_frame_rate.includes('/')) {
            const [num, den] = vStream.r_frame_rate.split('/').map(Number);
            if (den > 0) fps = Number((num / den).toFixed(2));
          }
        }
        hasAudioStream = Boolean(aStream);
      } catch {
        // continue to frame extraction
      }
    }

    const targetCount = 8;
    const effectiveDur = durationSec > 0 ? durationSec : 4;
    const keyframes: VideoKeyframeInput[] = [];

    for (let i = 0; i < targetCount; i++) {
      const ts = Number(
        ((effectiveDur * 0.9 * i) / (targetCount - 1) + effectiveDur * 0.05).toFixed(2)
      );
      const framePath = path.join(tmpDir, `frame-${i}.jpg`);
      try {
        await execFileAsync(
          '/usr/bin/ffmpeg',
          [
            '-y',
            '-ss',
            String(ts),
            '-i',
            inputPath,
            '-frames:v',
            '1',
            '-vf',
            'scale=640:-2',
            '-q:v',
            '4',
            framePath,
          ],
          { timeout: 8000 }
        );
        if (fs.existsSync(framePath)) {
          const jpg = fs.readFileSync(framePath);
          keyframes.push({
            timestampSec: ts,
            dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`,
          });
        }
      } catch {
        // skip out-of-range seek
      }
    }

    return {
      durationSec,
      width,
      height,
      fps,
      hasAudioStream,
      codecName,
      keyframes,
    };
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function computeTemporalFrameMetrics(
  keyframes: VideoKeyframeInput[]
): Promise<{
  frameMetrics: VideoFrameMetric[];
  maxMadJump: number;
  luminanceJitter: number;
  fftRatioVariance: number;
}> {
  const frameMetrics: VideoFrameMetric[] = [];
  let prevGray: Buffer | null = null;

  for (let i = 0; i < keyframes.length; i++) {
    try {
      const b64 = keyframes[i].dataUrl.split(',')[1] || '';
      const imgBuf = Buffer.from(b64, 'base64');
      const gray = await sharp(imgBuf)
        .resize(128, 128, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      let sumLuma = 0;
      for (let p = 0; p < gray.length; p++) sumLuma += gray[p];
      const meanLuminance = Number((sumLuma / Math.max(1, gray.length)).toFixed(1));

      let madFromPrev = 0;
      if (prevGray && prevGray.length === gray.length) {
        let diffSum = 0;
        for (let p = 0; p < gray.length; p++) {
          diffSum += Math.abs(gray[p] - prevGray[p]);
        }
        madFromPrev = Number((diffSum / gray.length).toFixed(2));
      }
      prevGray = gray;

      const spec = analyzeImageSpectrum(gray, 128);
      frameMetrics.push({
        frameIndex: i,
        timestampSec: keyframes[i].timestampSec,
        meanLuminance,
        madFromPrev,
        fftHighFreqRatio: spec.highFreqEnergyRatio,
      });
    } catch {
      // skip unreadable frame
    }
  }

  const mads = frameMetrics.slice(1).map((m) => m.madFromPrev);
  const maxMadJump = mads.length > 0 ? Math.max(...mads) : 0;
  const lumas = frameMetrics.map((m) => m.meanLuminance);
  const lumaMean = lumas.length > 0 ? lumas.reduce((a, b) => a + b, 0) / lumas.length : 0;
  const luminanceJitter =
    lumas.length > 1
      ? Number(
          Math.sqrt(
            lumas.reduce((acc, v) => acc + Math.pow(v - lumaMean, 2), 0) / lumas.length
          ).toFixed(2)
        )
      : 0;

  const ffts = frameMetrics.map((m) => m.fftHighFreqRatio);
  const fftMean = ffts.length > 0 ? ffts.reduce((a, b) => a + b, 0) / ffts.length : 0;
  const fftRatioVariance =
    ffts.length > 1
      ? Number(
          Math.sqrt(
            ffts.reduce((acc, v) => acc + Math.pow(v - fftMean, 2), 0) / ffts.length
          ).toFixed(4)
        )
      : 0;

  return { frameMetrics, maxMadJump, luminanceJitter, fftRatioVariance };
}

export async function analyzeVideoEvidence(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  durationSec?: number;
  width?: number;
  height?: number;
  keyframes?: VideoKeyframeInput[];
  caseDescription?: string;
}): Promise<VideoForensicResult> {
  const { buffer, filename, mimeType, caseDescription } = params;
  let durationSec = params.durationSec ?? 0;
  let width = params.width ?? 0;
  let height = params.height ?? 0;
  let keyframes = params.keyframes ?? [];
  let fps: number | null = null;
  let hasAudioStream: boolean | null = null;
  let codecName: string | null = null;

  // Use server-side FFmpeg when client keyframes are missing or too sparse (< 4)
  if (keyframes.length < 4) {
    const serverDecoded = await extractKeyframesWithFfmpeg(buffer, filename);
    if (serverDecoded) {
      if (serverDecoded.durationSec > 0) durationSec = serverDecoded.durationSec;
      if (serverDecoded.width > 0) width = serverDecoded.width;
      if (serverDecoded.height > 0) height = serverDecoded.height;
      fps = serverDecoded.fps;
      hasAudioStream = serverDecoded.hasAudioStream;
      codecName = serverDecoded.codecName;
      if (serverDecoded.keyframes.length > keyframes.length) {
        keyframes = serverDecoded.keyframes;
      }
    }
  }

  const containerInfo = inspectVideoContainerHeader(buffer, filename, mimeType);
  const provenance = scanBufferProvenance(buffer, containerInfo.detectedEncoderStrings);
  const temporalSignals = await computeTemporalFrameMetrics(keyframes);

  const metadata: Record<string, unknown> = {
    ...containerInfo,
    durationSec,
    width,
    height,
    fps,
    hasAudioStream,
    codecName,
    extractedFrameCount: keyframes.length,
    temporalSignals,
    provenance,
    keyframes: keyframes.map((k, idx) => ({
      frameIndex: idx,
      timestampSec: k.timestampSec,
      dataUrl: k.dataUrl,
    })),
  };

  const deterministicFindings: AnalyzedFinding[] = [];
  if (temporalSignals.fftRatioVariance > 0.035) {
    deterministicFindings.push({
      whatDetected: 'High-frequency spectral fluctuation across consecutive frames',
      whereDetected: 'Inter-frame 2D-FFT consistency series',
      whyFlagged: `Frame-to-frame high-frequency energy shifted sharply (std ${temporalSignals.fftRatioVariance}), which can happen with temporal deepfake blending or AI frame interpolation.`,
      analysisMethod: 'Multi-Frame Temporal 2D-FFT Consistency Analyzer',
      confidence: 64,
      limitations:
        'Rapid camera cuts, heavy motion blur, or variable bitrate keyframes can also alter per-frame spectral sharpness.',
      classification: 'Inconclusive',
      regionJson: null,
    });
  }

  if (provenance.hasWatermarkMarkers) {
    deterministicFindings.push({
      whatDetected: `Optional AI video generator metadata detected (${provenance.aiGeneratorSignatures.join(', ')})`,
      whereDetected: 'Optional Container / C2PA Header',
      whyFlagged: `Container header scan noted ${provenance.provenanceSummary}`,
      analysisMethod: 'Optional C2PA / Container Signature Scanner',
      confidence: 88,
      limitations:
        'Container metadata is optional provenance context; temporal frame inspection remains primary.',
      classification: 'Suspicious',
      regionJson: null,
    });
  }

  if (keyframes.length < 2) {
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary:
        'At least two video frames are required for multi-frame temporal analysis. Frame decoding was unavailable for this file format.',
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'Multi-frame temporal video decoding unavailable',
          whereDetected: 'Video Frame Extraction Stage',
          whyFlagged:
            'Could not decode at least 2 frames from the video stream; single-frame classification is prohibited.',
          analysisMethod: 'FFmpeg & Browser Video Keyframe Extractor',
          confidence: 0,
          limitations: 'Cannot inspect facial motion or inter-frame consistency without decoded frames.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary: `${keyframes.length} chronological frames decoded and temporal pixel/FFT shifts measured, while AI video sequence inspection is unavailable because GEMINI_API_KEY is not configured.`,
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'AI temporal video analyzer unavailable',
          whereDetected: 'Server AI Reasoning Layer',
          whyFlagged: 'GEMINI_API_KEY is missing or unconfigured.',
          analysisMethod: 'Multimodal Temporal Sequence Analyzer',
          confidence: 0,
          limitations: 'Configure GEMINI_API_KEY in Secrets to enable temporal facial & motion analysis.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }

  try {
    const sampledFrames = keyframes.slice(0, 8);
    const frameParts = sampledFrames.map((frame) => {
      const base64 = frame.dataUrl.split(',')[1] || '';
      return {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64,
        },
      };
    });

    const timelineLabels = sampledFrames
      .map((f, idx) => `Frame ${idx} (${f.timestampSec.toFixed(2)}s)`)
      .join(', ');

    const promptText = `Analyze these ${sampledFrames.length} chronological video frames (${timelineLabels}) from "${filename}" (${width}x${height}px, duration ${durationSec.toFixed(2)}s).
${caseDescription ? `Context notes: "${caseDescription}"\n` : ''}
Measured inter-frame temporal signals: ${JSON.stringify(temporalSignals.frameMetrics)}
Optional provenance scan (advisory only): ${provenance.provenanceSummary}

Evaluate across ALL frames together (NEVER classify the whole video from a single frame):
1. Facial movement, expressions, eye blinks, mouth/teeth coherence, and lip-speech articulation consistency across consecutive timestamps.
2. Temporal consistency (sudden lighting/shadow mismatches, flickering face boundaries, background warping, morphing objects, impossible motion physics).
3. Frame-level synthetic generation artifacts.
4. NEVER classify a video as REAL or AI-GENERATED solely because metadata/watermarks are missing.
5. Set "detectionLabel" to one of: "REAL", "AI-GENERATED / MANIPULATED", or "INCONCLUSIVE".
6. Set "aiProbability" (0-100) and calibrated "confidence" (0-100).
7. Provide "frameAnalysis" (one short observation per frame index) and timestamped findings for suspicious moments. Write "technicalSummary" in 2-3 clear plain-English sentences.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        detectionLabel: { type: Type.STRING },
        aiProbability: { type: Type.INTEGER },
        confidence: { type: Type.INTEGER },
        technicalSummary: { type: Type.STRING },
        frameAnalysis: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              frameIndex: { type: Type.INTEGER },
              timestampSec: { type: Type.NUMBER },
              observation: { type: Type.STRING },
              suspicious: { type: Type.BOOLEAN },
            },
          },
        },
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
              frameIndex: { type: Type.INTEGER },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
            },
          },
        },
      },
    };

    const parts = [...frameParts, { text: promptText }];
    const sysPrompt =
      'You are a fast, accurate video forensics specialist evaluating multi-frame temporal consistency, facial/lip dynamics, lighting coherence, and deepfake/AI-video artifacts. Never judge a video from one frame or missing metadata. Keep summaries and observations concise.';

    let usedModel = GEMINI_FAST_MODEL;
    let response;
    try {
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_MODEL,
            contents: { parts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 0, timeoutMs: 18_000, label: 'Fast video sequence check' }
      );
    } catch {
      usedModel = GEMINI_MODEL;
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: { parts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 1, timeoutMs: 25_000, label: 'Video sequence check' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const rawLabel = String(parsed.detectionLabel || '').toUpperCase();
    let detectionLabel: VideoDetectionLabel =
      rawLabel.includes('AI-GENERATED') || rawLabel.includes('MANIPULATED')
        ? 'AI-GENERATED / MANIPULATED'
        : rawLabel === 'REAL'
        ? 'REAL'
        : 'INCONCLUSIVE';

    if (provenance.hasWatermarkMarkers && detectionLabel === 'INCONCLUSIVE') {
      detectionLabel = 'AI-GENERATED / MANIPULATED';
    }

    const aiProbability = Math.max(0, Math.min(100, Math.round(Number(parsed.aiProbability ?? 50))));
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 55))));

    const classification: ForensicClassification =
      detectionLabel === 'AI-GENERATED / MANIPULATED'
        ? 'Suspicious'
        : detectionLabel === 'REAL'
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
          whatDetected: String(f.whatDetected || 'Temporal sequence observation'),
          whereDetected: String(
            f.whereDetected ||
              (typeof f.startSec === 'number'
                ? `Timestamp ${f.startSec.toFixed(2)}s`
                : 'Multi-frame sequence')
          ),
          whyFlagged: String(f.whyFlagged || 'Pattern observed across consecutive frames.'),
          analysisMethod: `Multi-Frame Temporal & Facial Sequence Analysis (${usedModel})`,
          confidence: Math.max(0, Math.min(100, Number(f.confidence ?? confidence))),
          limitations: String(
            f.limitations ||
              'Evaluates sampled keyframes and temporal deltas rather than uncompressed optical flow on every frame.'
          ),
          classification: validClassifications.includes(f.classification)
            ? f.classification
            : classification,
          regionJson: {
            frameIndex: typeof f.frameIndex === 'number' ? f.frameIndex : undefined,
            startSec: typeof f.startSec === 'number' ? f.startSec : undefined,
            endSec: typeof f.endSec === 'number' ? f.endSec : undefined,
          },
        }))
      : [];

    return {
      classification,
      detectionLabel,
      aiProbability,
      confidence,
      technicalSummary: String(
        parsed.technicalSummary || 'Multi-frame temporal video analysis completed.'
      ),
      metadata: {
        ...metadata,
        detectionLabel,
        aiProbability,
        frameAnalysis: Array.isArray(parsed.frameAnalysis) ? parsed.frameAnalysis : [],
      },
      findings: [...aiFindings, ...deterministicFindings],
    };
  } catch (error) {
    const errMsg = formatGeminiError(error);
    if (provenance.hasWatermarkMarkers) {
      return {
        classification: 'Suspicious',
        detectionLabel: 'AI-GENERATED / MANIPULATED',
        aiProbability: 88,
        confidence: 78,
        technicalSummary: `${keyframes.length} keyframes and temporal pixel shifts extracted, and confirmed AI video provenance markers were found (${provenance.aiGeneratorSignatures.join(', ')}). Visual sequence AI timed out (${errMsg}).`,
        metadata: {
          ...metadata,
          detectionLabel: 'AI-GENERATED / MANIPULATED',
          aiProbability: 88,
        },
        findings: [
          ...deterministicFindings,
          {
            whatDetected: 'Temporal AI inspection timed out (confirmed provenance marker present)',
            whereDetected: 'Video Sequence Analysis Pipeline',
            whyFlagged: errMsg,
            analysisMethod: 'Temporal Signal + Optional C2PA Fallback',
            confidence: 78,
            limitations: 'Visual sequence reasoning did not complete; verdict relies on confirmed container/C2PA AI markers and temporal signal measurements.',
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
      technicalSummary: `Keyframes and temporal pixel/FFT shifts extracted, while AI sequence evaluation failed: ${errMsg}`,
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'Temporal video reasoning unavailable',
          whereDetected: 'Video Sequence Analysis Pipeline',
          whyFlagged: errMsg,
          analysisMethod: 'Multi-Frame Temporal Sequence Analyzer',
          confidence: 0,
          limitations: 'Upstream model failure prevented multi-frame classification.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }
}
