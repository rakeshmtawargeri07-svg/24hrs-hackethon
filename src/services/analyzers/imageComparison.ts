import { ThinkingLevel, Type } from '@google/genai';
import exifr from 'exifr';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  GEMINI_FAST_MODEL,
  GEMINI_MODEL,
  formatGeminiError,
  getGeminiClient,
  parseGeminiJson,
  withRetry,
} from '../geminiClient.ts';
import { analyzeImageSpectrum, ImageSpectralMetrics } from '../signal/fft.ts';
import { ProvenanceScanResult, scanBufferProvenance } from '../signal/provenanceScanner.ts';

export type ImageComparisonVerdict =
  | 'AI-GENERATED'
  | 'MANIPULATED / EDITED'
  | 'REAL / AUTHENTIC'
  | 'INCONCLUSIVE';

export interface ComparedImageSignals {
  filename: string;
  width: number;
  height: number;
  format: string;
  elaMeanDelta: number;
  elaMaxDelta: number;
  fftMetrics: ImageSpectralMetrics | null;
  laplacianMean: number | null;
  blockNoiseUniformity: number | null;
  hasCameraHardwareTags: boolean;
  cameraLabel: string | null;
  software: string | null;
  provenance: ProvenanceScanResult;
  previewUrl: string;
}

export interface ComparisonDifferenceItem {
  area: string;
  realObservation: string;
  suspiciousObservation: string;
  significance: 'Suspicious' | 'Inconclusive' | 'Consistent';
  suspiciousRegion: { x: number; y: number; width: number; height: number } | null;
}

export interface ImageComparisonResult {
  verdict: ImageComparisonVerdict;
  suspiciousAiProbability: number | null;
  confidence: number;
  sameSceneOrSubject: boolean;
  summary: string;
  limitations: string;
  modelUsed: string;
  pixelSimilarityPct: number;
  meanPixelDiffPct: number;
  noiseDelta: number | null;
  fftDelta: number | null;
  diffHeatmapUrl: string | null;
  realImage: ComparedImageSignals;
  suspiciousImage: ComparedImageSignals;
  differences: ComparisonDifferenceItem[];
}

function computeNoiseSummary(
  rgb: Buffer,
  width: number,
  height: number,
  channels: number
): { laplacianMean: number; blockNoiseUniformity: number } {
  const sampleW = Math.min(width, 256);
  const sampleH = Math.min(height, 256);
  const stepX = Math.max(1, Math.floor(width / sampleW));
  const stepY = Math.max(1, Math.floor(height / sampleH));

  const luma = new Float64Array(sampleW * sampleH);
  for (let sy = 0; sy < sampleH; sy++) {
    const oy = Math.min(height - 1, sy * stepY);
    for (let sx = 0; sx < sampleW; sx++) {
      const ox = Math.min(width - 1, sx * stepX);
      const p = (oy * width + ox) * channels;
      const r = rgb[p] ?? 0;
      const g = rgb[p + 1] ?? r;
      const b = rgb[p + 2] ?? r;
      luma[sy * sampleW + sx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  let lapSum = 0;
  let lapCount = 0;
  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const i = y * sampleW + x;
      const lap = Math.abs(
        4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - sampleW] - luma[i + sampleW]
      );
      lapSum += lap;
      lapCount++;
    }
  }
  const laplacianMean = Number((lapSum / Math.max(1, lapCount)).toFixed(2));

  const blockVars: number[] = [];
  const bw = Math.max(8, Math.floor(sampleW / 8));
  const bh = Math.max(8, Math.floor(sampleH / 8));
  for (let by = 0; by + bh <= sampleH; by += bh) {
    for (let bx = 0; bx + bw <= sampleW; bx += bw) {
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let y = by + 1; y < by + bh - 1; y++) {
        for (let x = bx + 1; x < bx + bw - 1; x++) {
          const i = y * sampleW + x;
          const lap = Math.abs(
            4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - sampleW] - luma[i + sampleW]
          );
          sum += lap;
          sumSq += lap * lap;
          count++;
        }
      }
      if (count > 0) {
        const m = sum / count;
        blockVars.push(Math.max(0, sumSq / count - m * m));
      }
    }
  }

  let blockNoiseUniformity = 0;
  if (blockVars.length > 1) {
    const bvMean = blockVars.reduce((a, b) => a + b, 0) / blockVars.length;
    const bvStd = Math.sqrt(
      blockVars.reduce((acc, v) => acc + Math.pow(v - bvMean, 2), 0) / blockVars.length
    );
    blockNoiseUniformity = bvMean > 0 ? Number((bvStd / bvMean).toFixed(3)) : 0;
  }

  return { laplacianMean, blockNoiseUniformity };
}

async function extractSingleImageMetrics(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  previewUrl: string;
}) {
  const { buffer, filename, mimeType, previewUrl } = params;
  const exifPromise = exifr
    .parse(buffer, { exif: true, xmp: true, iptc: true, icc: true, tiff: true })
    .catch(() => null);

  let width = 0;
  let height = 0;
  let format = mimeType;
  let elaMeanDelta = 0;
  let elaMaxDelta = 0;
  let fftMetrics: ImageSpectralMetrics | null = null;
  let laplacianMean: number | null = null;
  let blockNoiseUniformity: number | null = null;
  let visionBuffer = buffer;
  let visionMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

  const [meta, gray128, rawScaled] = await Promise.all([
    sharp(buffer).metadata(),
    sharp(buffer).rotate().resize(128, 128, { fit: 'cover' }).grayscale().raw().toBuffer(),
    sharp(buffer)
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  width = meta.width ?? 0;
  height = meta.height ?? 0;
  format = meta.format ?? mimeType;

  fftMetrics = analyzeImageSpectrum(gray128, 128);
  const noise = computeNoiseSummary(
    rawScaled.data,
    rawScaled.info.width,
    rawScaled.info.height,
    rawScaled.info.channels
  );
  laplacianMean = noise.laplacianMean;
  blockNoiseUniformity = noise.blockNoiseUniformity;

  const scaledRawInput = {
    raw: {
      width: rawScaled.info.width,
      height: rawScaled.info.height,
      channels: rawScaled.info.channels as 1 | 2 | 3 | 4,
    },
  };

  const needsVisionResize = width > 896 || height > 896 || buffer.length > 350_000;
  const [recompressed, resizedVision] = await Promise.all([
    sharp(rawScaled.data, scaledRawInput).jpeg({ quality: 85 }).toBuffer(),
    needsVisionResize
      ? sharp(buffer)
          .rotate()
          .resize({ width: 896, height: 896, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer()
      : Promise.resolve(null),
  ]);

  if (resizedVision) {
    visionBuffer = resizedVision;
    visionMime = 'image/jpeg';
  }

  const rawRecomp = await sharp(recompressed).raw().toBuffer({ resolveWithObject: true });
  const len = Math.min(rawScaled.data.length, rawRecomp.data.length);
  let sumDelta = 0;
  let maxDelta = 0;
  for (let i = 0; i < len; i++) {
    const d = Math.abs(rawScaled.data[i] - rawRecomp.data[i]);
    sumDelta += d;
    if (d > maxDelta) maxDelta = d;
  }
  elaMeanDelta = Number((sumDelta / Math.max(1, len)).toFixed(2));
  elaMaxDelta = maxDelta;

  const parsedExif = await exifPromise;
  let make: string | null = null;
  let model: string | null = null;
  let software: string | null = null;
  const extraStrings: string[] = [];

  if (parsedExif && typeof parsedExif === 'object') {
    software = String(
      parsedExif.Software || parsedExif.CreatorTool || parsedExif.ProcessingSoftware || ''
    ).trim() || null;
    make = parsedExif.Make ? String(parsedExif.Make) : null;
    model = parsedExif.Model ? String(parsedExif.Model) : null;
    extraStrings.push(software ?? '', make ?? '', model ?? '', String(parsedExif.DigitalSourceType ?? ''));
  }

  const provenance = scanBufferProvenance(buffer, extraStrings);

  const signals: ComparedImageSignals = {
    filename,
    width,
    height,
    format,
    elaMeanDelta,
    elaMaxDelta,
    fftMetrics,
    laplacianMean,
    blockNoiseUniformity,
    hasCameraHardwareTags: Boolean(make || model),
    cameraLabel: [make, model].filter(Boolean).join(' ') || null,
    software,
    provenance,
    previewUrl,
  };

  return { signals, visionBuffer, visionMime };
}

export async function compareRealVsSuspiciousImages(params: {
  realBuffer: Buffer;
  realFilename: string;
  realMimeType: string;
  realPreviewUrl: string;
  suspiciousBuffer: Buffer;
  suspiciousFilename: string;
  suspiciousMimeType: string;
  suspiciousPreviewUrl: string;
  elaDir: string;
  comparisonId: string;
  notes?: string;
}): Promise<ImageComparisonResult> {
  const {
    realBuffer,
    realFilename,
    realMimeType,
    realPreviewUrl,
    suspiciousBuffer,
    suspiciousFilename,
    suspiciousMimeType,
    suspiciousPreviewUrl,
    elaDir,
    comparisonId,
    notes,
  } = params;

  const [realData, suspData, realAligned, suspAligned] = await Promise.all([
    extractSingleImageMetrics({
      buffer: realBuffer,
      filename: realFilename,
      mimeType: realMimeType,
      previewUrl: realPreviewUrl,
    }),
    extractSingleImageMetrics({
      buffer: suspiciousBuffer,
      filename: suspiciousFilename,
      mimeType: suspiciousMimeType,
      previewUrl: suspiciousPreviewUrl,
    }),
    sharp(realBuffer).rotate().resize(384, 384, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    sharp(suspiciousBuffer).rotate().resize(384, 384, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
  ]);

  // Compute direct normalized RGB pixel difference map & Pearson structural correlation
  const len = Math.min(realAligned.length, suspAligned.length);
  const diffBuf = Buffer.allocUnsafe(len);
  let sumAbs = 0;
  let sumR = 0;
  let sumS = 0;
  for (let i = 0; i < len; i++) {
    const r = realAligned[i];
    const s = suspAligned[i];
    const d = Math.abs(r - s);
    sumAbs += d;
    sumR += r;
    sumS += s;
    diffBuf[i] = Math.min(255, d * 5);
  }
  const meanR = sumR / Math.max(1, len);
  const meanS = sumS / Math.max(1, len);
  let cov = 0;
  let varR = 0;
  let varS = 0;
  for (let i = 0; i < len; i++) {
    const dr = realAligned[i] - meanR;
    const ds = suspAligned[i] - meanS;
    cov += dr * ds;
    varR += dr * dr;
    varS += ds * ds;
  }
  const corr = cov / Math.sqrt(Math.max(1e-6, varR * varS));
  const pixelSimilarityPct = Math.max(0, Math.min(100, Math.round(((corr + 1) / 2) * 100)));
  const meanPixelDiffPct = Number(((sumAbs / Math.max(1, len) / 255) * 100).toFixed(1));

  await fs.promises.mkdir(elaDir, { recursive: true });
  const diffFilename = `${comparisonId}-diff.png`;
  const diffPath = path.join(elaDir, diffFilename);
  await sharp(diffBuf, { raw: { width: 384, height: 384, channels: 3 } })
    .png({ compressionLevel: 1 })
    .toFile(diffPath);
  const diffHeatmapUrl = `/uploads/ela/${diffFilename}`;

  const noiseDelta =
    realData.signals.laplacianMean !== null && suspData.signals.laplacianMean !== null
      ? Number((suspData.signals.laplacianMean - realData.signals.laplacianMean).toFixed(2))
      : null;

  const fftDelta =
    realData.signals.fftMetrics && suspData.signals.fftMetrics
      ? Number(
          (
            suspData.signals.fftMetrics.highFreqEnergyRatio -
            realData.signals.fftMetrics.highFreqEnergyRatio
          ).toFixed(3)
        )
      : null;

  const ai = getGeminiClient();
  if (!ai) {
    const hasMarker = suspData.signals.provenance.hasWatermarkMarkers;
    return {
      verdict: hasMarker ? 'AI-GENERATED' : 'INCONCLUSIVE',
      suspiciousAiProbability: hasMarker ? 88 : null,
      confidence: hasMarker ? 80 : 0,
      sameSceneOrSubject: pixelSimilarityPct >= 62,
      summary: hasMarker
        ? `Embedded AI generator metadata detected in the suspicious image (${suspData.signals.provenance.aiGeneratorSignatures.join(', ')}). Visual comparison AI service is not configured.`
        : 'Visual comparison AI service is not configured (GEMINI_API_KEY missing). Pixel similarity, 2D-FFT, and noise residual measurements were computed below without estimating a synthetic verdict.',
      limitations: 'AI visual comparison unavailable; signal metrics alone cannot replace full visual inspection.',
      modelUsed: 'Signal-Only (Pixel/FFT/Noise)',
      pixelSimilarityPct,
      meanPixelDiffPct,
      noiseDelta,
      fftDelta,
      diffHeatmapUrl,
      realImage: realData.signals,
      suspiciousImage: suspData.signals,
      differences: [],
    };
  }

  const promptText = `You are comparing TWO images side-by-side:
- Image 1 (REFERENCE REAL PHOTO): "${realFilename}" (${realData.signals.width}x${realData.signals.height}, ${realData.signals.format}), LaplacianNoise=${realData.signals.laplacianMean}, BlockUniformity=${realData.signals.blockNoiseUniformity}, FFT_HF=${realData.signals.fftMetrics?.highFreqEnergyRatio}, FFT_GridPeak=${realData.signals.fftMetrics?.periodicGridPeakRatio}x, ELA=${realData.signals.elaMeanDelta}.
- Image 2 (SUSPICIOUS PHOTO TO TEST): "${suspiciousFilename}" (${suspData.signals.width}x${suspData.signals.height}, ${suspData.signals.format}), LaplacianNoise=${suspData.signals.laplacianMean}, BlockUniformity=${suspData.signals.blockNoiseUniformity}, FFT_HF=${suspData.signals.fftMetrics?.highFreqEnergyRatio}, FFT_GridPeak=${suspData.signals.fftMetrics?.periodicGridPeakRatio}x, ELA=${suspData.signals.elaMeanDelta}, Provenance=${suspData.signals.provenance.provenanceSummary}.
Measured cross-image pixel similarity: ${pixelSimilarityPct}% (mean pixel delta ${meanPixelDiffPct}%).
${notes ? `User notes: "${notes}"\n` : ''}
Task:
1. Determine whether Image 2 (the suspicious photo) is AI-GENERATED, MANIPULATED / EDITED (e.g., face swap, AI inpainting, object removal/addition compared to Image 1), REAL / AUTHENTIC (genuine camera photo or harmless crop/recompression), or INCONCLUSIVE.
2. Compare Image 2 directly against Image 1 (the real reference):
   - If both show the same person or scene, check facial geometry, skin pores, hair strands, glasses/eye reflections, lighting direction, shadows, background seams, and grain texture for edits or AI generation.
   - If they show different scenes, use Image 1 as the baseline for natural camera grain, skin/material realism, and lighting physics, and judge Image 2 on its own visual authenticity.
3. NEVER judge solely on missing EXIF or social-media JPEG compression (e.g., WhatsApp compression is normal in real photos).
4. Return concise JSON with 2-4 specific side-by-side differences and optional 0-100% bounding boxes highlighting where Image 2 differs or looks synthetic.`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      verdict: {
        type: Type.STRING,
        description:
          'Exactly one of: "AI-GENERATED", "MANIPULATED / EDITED", "REAL / AUTHENTIC", or "INCONCLUSIVE".',
      },
      suspiciousAiProbability: {
        type: Type.INTEGER,
        description: '0-100 integer likelihood that Image 2 is AI-generated or AI-manipulated.',
      },
      confidence: {
        type: Type.INTEGER,
        description: '0-100 integer confidence in the comparison verdict.',
      },
      sameSceneOrSubject: {
        type: Type.BOOLEAN,
        description: 'True if Image 1 and Image 2 depict the same person, scene, or base photograph.',
      },
      summary: {
        type: Type.STRING,
        description: 'Clear 2-3 sentence plain-English explanation comparing Image 2 against Image 1.',
      },
      limitations: {
        type: Type.STRING,
        description: 'Concise 1-sentence caveat (e.g., compression, different scene, resolution).',
      },
      differences: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            area: { type: Type.STRING },
            realObservation: { type: Type.STRING },
            suspiciousObservation: { type: Type.STRING },
            significance: {
              type: Type.STRING,
              description: '"Suspicious", "Inconclusive", or "Consistent".',
            },
            suspiciousRegion: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER },
              },
            },
          },
        },
      },
    },
  };

  const parts = [
    { text: 'Image 1 — Real Reference Photo:' },
    {
      inlineData: {
        mimeType: realData.visionMime,
        data: realData.visionBuffer.toString('base64'),
      },
    },
    { text: 'Image 2 — Suspicious Photo to Check:' },
    {
      inlineData: {
        mimeType: suspData.visionMime,
        data: suspData.visionBuffer.toString('base64'),
      },
    },
    { text: promptText },
  ];

  try {
    let modelUsed = GEMINI_FAST_MODEL;
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
              systemInstruction:
                'You are an expert image forensics analyst comparing a known real photo against a suspicious photo. Give an accurate, grounded verdict without false positives on genuine compressed camera photos.',
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 0, timeoutMs: 16_000, label: 'Fast two-image comparison' }
      );
    } catch {
      modelUsed = GEMINI_MODEL;
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: { parts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                'You are an expert image forensics analyst comparing a known real photo against a suspicious photo. Give an accurate, grounded verdict without false positives on genuine compressed camera photos.',
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 1, timeoutMs: 24_000, label: 'Two-image comparison' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const rawVerdict = String(parsed.verdict || '').toUpperCase();
    let verdict: ImageComparisonVerdict =
      rawVerdict.includes('AI-GENERATED')
        ? 'AI-GENERATED'
        : rawVerdict.includes('MANIPULATED') || rawVerdict.includes('EDITED')
        ? 'MANIPULATED / EDITED'
        : rawVerdict.includes('REAL') || rawVerdict.includes('AUTHENTIC')
        ? 'REAL / AUTHENTIC'
        : 'INCONCLUSIVE';

    if (suspData.signals.provenance.hasWatermarkMarkers && verdict === 'INCONCLUSIVE') {
      verdict = 'AI-GENERATED';
    }

    const suspiciousAiProbability = Math.max(
      0,
      Math.min(100, Math.round(Number(parsed.suspiciousAiProbability ?? 50)))
    );
    const confidence = Math.max(
      0,
      Math.min(100, Math.round(Number(parsed.confidence ?? 60)))
    );

    const differences: ComparisonDifferenceItem[] = Array.isArray(parsed.differences)
      ? parsed.differences.map((d: any) => {
          const sigRaw = String(d.significance || '');
          const significance: ComparisonDifferenceItem['significance'] =
            sigRaw === 'Suspicious' || sigRaw === 'Consistent' ? sigRaw : 'Inconclusive';
          const r = d.suspiciousRegion;
          return {
            area: String(d.area || 'Visual comparison region'),
            realObservation: String(d.realObservation || 'Natural camera detail observed.'),
            suspiciousObservation: String(d.suspiciousObservation || 'Observed region state.'),
            significance,
            suspiciousRegion:
              r &&
              typeof r.x === 'number' &&
              typeof r.y === 'number' &&
              typeof r.width === 'number' &&
              typeof r.height === 'number'
                ? {
                    x: Math.max(0, Math.min(100, r.x)),
                    y: Math.max(0, Math.min(100, r.y)),
                    width: Math.max(2, Math.min(100, r.width)),
                    height: Math.max(2, Math.min(100, r.height)),
                  }
                : null,
          };
        })
      : [];

    return {
      verdict,
      suspiciousAiProbability,
      confidence,
      sameSceneOrSubject: Boolean(parsed.sameSceneOrSubject),
      summary: String(
        parsed.summary || 'Side-by-side visual and pixel comparison completed.'
      ),
      limitations: String(
        parsed.limitations ||
          'Comparison accuracy can be affected by heavy messaging compression, cropping, or comparing unrelated scenes.'
      ),
      modelUsed,
      pixelSimilarityPct,
      meanPixelDiffPct,
      noiseDelta,
      fftDelta,
      diffHeatmapUrl,
      realImage: realData.signals,
      suspiciousImage: suspData.signals,
      differences,
    };
  } catch (error) {
    const errMsg = formatGeminiError(error);
    const hasMarker = suspData.signals.provenance.hasWatermarkMarkers;
    return {
      verdict: hasMarker ? 'AI-GENERATED' : 'INCONCLUSIVE',
      suspiciousAiProbability: hasMarker ? 88 : null,
      confidence: hasMarker ? 80 : 0,
      sameSceneOrSubject: pixelSimilarityPct >= 62,
      summary: hasMarker
        ? `Embedded AI generator metadata detected (${suspData.signals.provenance.aiGeneratorSignatures.join(', ')}). Visual AI comparison did not complete (${errMsg}).`
        : `Visual comparison AI call did not complete (${errMsg}). Pixel similarity (${pixelSimilarityPct}%) and spectral/noise metrics are shown below without guessing an AI verdict.`,
      limitations: 'Visual AI comparison could not complete; retry once connection stabilizes.',
      modelUsed: 'Signal-Only Fallback',
      pixelSimilarityPct,
      meanPixelDiffPct,
      noiseDelta,
      fftDelta,
      diffHeatmapUrl,
      realImage: realData.signals,
      suspiciousImage: suspData.signals,
      differences: [],
    };
  }
}
