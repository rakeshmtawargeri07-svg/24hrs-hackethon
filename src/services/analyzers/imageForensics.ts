import { ThinkingLevel, Type } from '@google/genai';
import exifr from 'exifr';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ForensicClassification, FindingRegion } from '../../db/schema.ts';
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

export interface AnalyzedFinding {
  whatDetected: string;
  whereDetected: string;
  whyFlagged: string;
  analysisMethod: string;
  confidence: number;
  limitations: string;
  classification: ForensicClassification;
  regionJson: FindingRegion | null;
}

export type ImageDetectionLabel = 'REAL' | 'AI-GENERATED' | 'INCONCLUSIVE';

export interface ImageNoiseMetrics {
  laplacianMean: number;
  laplacianStd: number;
  blockNoiseUniformity: number; // Coefficient of variation across 8x8 block variances
  chromaLuminanceCorr: number;
}

export interface ImageForensicResult {
  classification: ForensicClassification;
  detectionLabel: ImageDetectionLabel;
  aiProbability: number;
  confidence: number;
  technicalSummary: string;
  elaUrl: string | null;
  metadata: Record<string, unknown>;
  findings: AnalyzedFinding[];
}

const EDITING_SOFTWARE_MARKERS = [
  'photoshop',
  'gimp',
  'lightroom',
  'affinity',
  'canva',
  'midjourney',
  'dall-e',
  'stable diffusion',
  'automatic1111',
  'comfyui',
  'firefly',
  'topaz',
  'snapseed',
  'facetune',
  'remini',
];

function computeLaplacianNoiseMetrics(
  rgb: Buffer,
  width: number,
  height: number,
  channels: number
): ImageNoiseMetrics {
  const sampleW = Math.min(width, 256);
  const sampleH = Math.min(height, 256);
  const stepX = Math.max(1, Math.floor(width / sampleW));
  const stepY = Math.max(1, Math.floor(height / sampleH));

  const luma = new Float64Array(sampleW * sampleH);
  const chroma = new Float64Array(sampleW * sampleH);

  for (let sy = 0; sy < sampleH; sy++) {
    const oy = Math.min(height - 1, sy * stepY);
    for (let sx = 0; sx < sampleW; sx++) {
      const ox = Math.min(width - 1, sx * stepX);
      const p = (oy * width + ox) * channels;
      const r = rgb[p] ?? 0;
      const g = rgb[p + 1] ?? r;
      const b = rgb[p + 2] ?? r;
      luma[sy * sampleW + sx] = 0.299 * r + 0.587 * g + 0.114 * b;
      chroma[sy * sampleW + sx] = Math.abs(r - b);
    }
  }

  const lapVals: number[] = [];
  const lapChroma: number[] = [];

  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const i = y * sampleW + x;
      const lap =
        4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - sampleW] - luma[i + sampleW];
      const cLap =
        4 * chroma[i] -
        chroma[i - 1] -
        chroma[i + 1] -
        chroma[i - sampleW] -
        chroma[i + sampleW];
      lapVals.push(Math.abs(lap));
      lapChroma.push(Math.abs(cLap));
    }
  }

  const n = Math.max(1, lapVals.length);
  const lapMean = lapVals.reduce((a, b) => a + b, 0) / n;
  const lapVar = lapVals.reduce((acc, v) => acc + Math.pow(v - lapMean, 2), 0) / n;
  const lapStd = Math.sqrt(lapVar);

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
    blockNoiseUniformity = bvMean > 0 ? bvStd / bvMean : 0;
  }

  const cMean = lapChroma.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varC = 0;
  for (let i = 0; i < lapVals.length; i++) {
    cov += (lapVals[i] - lapMean) * (lapChroma[i] - cMean);
    varC += Math.pow(lapChroma[i] - cMean, 2);
  }
  const denom = Math.sqrt(Math.max(1e-9, lapVar * n * varC));
  const corr = denom > 0 ? cov / denom : 0;

  return {
    laplacianMean: Number(lapMean.toFixed(2)),
    laplacianStd: Number(lapStd.toFixed(2)),
    blockNoiseUniformity: Number(blockNoiseUniformity.toFixed(3)),
    chromaLuminanceCorr: Number(corr.toFixed(3)),
  };
}

function buildFallbackSignalResult(params: {
  reason: string;
  elaUrl: string | null;
  combinedMetadata: Record<string, unknown>;
  fftMetrics: ImageSpectralMetrics | null;
  noiseMetrics: ImageNoiseMetrics | null;
  provenance: ProvenanceScanResult;
  contentFindings: AnalyzedFinding[];
  provenanceFindings: AnalyzedFinding[];
}): ImageForensicResult {
  const {
    reason,
    elaUrl,
    combinedMetadata,
    fftMetrics,
    noiseMetrics,
    provenance,
    contentFindings,
    provenanceFindings,
  } = params;

  const hasExplicitMarker = provenance.hasWatermarkMarkers;

  if (hasExplicitMarker) {
    const fftNote = fftMetrics
      ? `2D-FFT periodic ratio ${fftMetrics.periodicGridPeakRatio}x.`
      : '';
    return {
      classification: 'Suspicious',
      detectionLabel: 'AI-GENERATED',
      aiProbability: 88,
      confidence: 80,
      technicalSummary: `Embedded AI generator metadata found (${provenance.aiGeneratorSignatures.join(', ')}). ${fftNote} Visual AI inspection did not complete (${reason}).`.trim(),
      elaUrl,
      metadata: {
        ...combinedMetadata,
        detectionLabel: 'AI-GENERATED',
        aiProbability: 88,
      },
      findings: [
        ...contentFindings,
        ...provenanceFindings,
        {
          whatDetected: 'Visual AI layer unavailable (provenance marker present)',
          whereDetected: 'Visual Reasoning Pipeline',
          whyFlagged: reason,
          analysisMethod: '2D-FFT + Laplacian Noise + Optional Provenance Fallback',
          confidence: 80,
          limitations: 'Visual semantic inspection timed out; verdict reflects confirmed AI generator metadata.',
          classification: 'Suspicious',
          regionJson: null,
        },
      ],
    };
  }

  const fftNote = fftMetrics
    ? `2D-FFT high-frequency energy ${(fftMetrics.highFreqEnergyRatio * 100).toFixed(1)}%.`
    : '';
  const noiseNote = noiseMetrics
    ? `Pixel noise residual mean is ${noiseMetrics.laplacianMean}.`
    : '';
  const summary = `Visual AI inspection did not complete (${reason}), so authentic vs. AI-generated classification cannot be determined reliably from compression/noise metrics alone. ${fftNote} ${noiseNote}`.trim();

  return {
    classification: 'Analysis Unavailable',
    detectionLabel: 'INCONCLUSIVE',
    aiProbability: 0,
    confidence: 0,
    technicalSummary: summary,
    elaUrl,
    metadata: {
      ...combinedMetadata,
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: null,
    },
    findings: [
      ...contentFindings,
      ...provenanceFindings,
      {
        whatDetected: 'Visual AI inspection unavailable (cannot classify image reliably)',
        whereDetected: 'Visual Reasoning Pipeline',
        whyFlagged: reason,
        analysisMethod: '2D-FFT + Laplacian Noise + Optional Provenance Fallback',
        confidence: 0,
        limitations:
          'Without visual content inspection, pixel/FFT metrics on compressed photos cannot distinguish real photos from AI images.',
        classification: 'Analysis Unavailable',
        regionJson: null,
      },
    ],
  };
}

export async function analyzeImageEvidence(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  sha256Hash: string;
  elaDir: string;
  caseDescription?: string;
}): Promise<ImageForensicResult> {
  const { buffer, filename, mimeType, sha256Hash, elaDir, caseDescription } = params;
  const contentFindings: AnalyzedFinding[] = [];
  const provenanceFindings: AnalyzedFinding[] = [];

  let elaUrl: string | null = null;
  let width = 0;
  let height = 0;
  let format = mimeType;
  let elaMeanDelta = 0;
  let elaMaxDelta = 0;
  let fftMetrics: ImageSpectralMetrics | null = null;
  let noiseMetrics: ImageNoiseMetrics | null = null;

  let geminiPayloadBuffer = buffer;
  let geminiPayloadMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

  const exifPromise = exifr
    .parse(buffer, {
      exif: true,
      xmp: true,
      iptc: true,
      icc: true,
      tiff: true,
    })
    .catch(() => null);

  try {
    // Bound ELA & noise buffer to 640px for fast <150ms execution even on huge 8-20MB PNGs
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
    noiseMetrics = computeLaplacianNoiseMetrics(
      rawScaled.data,
      rawScaled.info.width,
      rawScaled.info.height,
      rawScaled.info.channels
    );

    const scaledRawInput = {
      raw: {
        width: rawScaled.info.width,
        height: rawScaled.info.height,
        channels: rawScaled.info.channels as 1 | 2 | 3 | 4,
      },
    };

    // Compact 896px JPEG payload keeps Gemini vision upload & decode fast (~50-120 KB)
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
      geminiPayloadBuffer = resizedVision;
      geminiPayloadMime = 'image/jpeg';
    }

    const rawRecomp = await sharp(recompressed).raw().toBuffer({ resolveWithObject: true });
    const len = Math.min(rawScaled.data.length, rawRecomp.data.length);
    const diffBuf = Buffer.allocUnsafe(len);
    let sumDelta = 0;
    let maxDelta = 0;

    for (let i = 0; i < len; i++) {
      const d = Math.abs(rawScaled.data[i] - rawRecomp.data[i]);
      sumDelta += d;
      if (d > maxDelta) maxDelta = d;
      diffBuf[i] = d > 21 ? 255 : d * 12;
    }

    elaMeanDelta = Number((sumDelta / Math.max(1, len)).toFixed(2));
    elaMaxDelta = maxDelta;

    fs.mkdirSync(elaDir, { recursive: true });
    const elaFilename = `${sha256Hash.slice(0, 16)}-ela.png`;
    const elaDiskPath = path.join(elaDir, elaFilename);

    await sharp(diffBuf, scaledRawInput).png({ compressionLevel: 1 }).toFile(elaDiskPath);

    elaUrl = `/uploads/ela/${elaFilename}`;

    const isJpeg = String(format).toLowerCase().includes('jpeg') || String(format).toLowerCase().includes('jpg');
    const fftGridThreshold = isJpeg ? 22 : 14;
    if (fftMetrics.periodicGridPeakRatio > fftGridThreshold) {
      contentFindings.push({
        whatDetected: 'Periodic high-frequency grid spike in 2D FFT spectrum',
        whereDetected: 'Frequency domain (Nyquist / upsampling harmonics)',
        whyFlagged: `2D FFT detected a periodic spectral peak ratio of ${fftMetrics.periodicGridPeakRatio}x above median high-frequency energy, which can occur from neural upsampling or resampling grids.`,
        analysisMethod: '2D-FFT Frequency Domain Spectrum Analysis',
        confidence: Math.min(82, Math.round(50 + fftMetrics.periodicGridPeakRatio)),
        limitations:
          'Aggressive nearest-neighbor resizing, screenshot scaling, or halftone print scans can also produce periodic grid peaks.',
        classification: 'Inconclusive',
        regionJson: null,
      });
    }

    if (elaMeanDelta > 7.5 || elaMaxDelta > 95) {
      contentFindings.push({
        whatDetected: 'Elevated compression residual variance in edit heatmap',
        whereDetected: 'Global pixel compression grid (Q85 residual)',
        whyFlagged: `Mean pixel difference is ${elaMeanDelta} (peak ${elaMaxDelta}/255), which can appear when parts of an image have different compression histories or local edits.`,
        analysisMethod: 'Error Level Analysis (Q85 12x Residual)',
        confidence: Math.min(78, Math.round(45 + elaMeanDelta * 2.5)),
        limitations:
          'Lossless PNG conversions, sharp high-contrast textures, or repeated social media saves can elevate residuals without tampering.',
        classification: 'Inconclusive',
        regionJson: null,
      });
    }
  } catch (err) {
    console.warn('Sharp pixel/FFT processing partial error:', err);
  }

  let exifSummary: Record<string, unknown> = {
    width,
    height,
    format,
    elaMeanDelta,
    elaMaxDelta,
    hasCameraHardwareTags: false,
  };
  let extraStrings: string[] = [];

  const parsedExif = await exifPromise;
  if (parsedExif && typeof parsedExif === 'object') {
    const software = String(
      parsedExif.Software || parsedExif.CreatorTool || parsedExif.ProcessingSoftware || ''
    );
    const make = parsedExif.Make ? String(parsedExif.Make) : null;
    const model = parsedExif.Model ? String(parsedExif.Model) : null;
    const dateOriginal = parsedExif.DateTimeOriginal ? String(parsedExif.DateTimeOriginal) : null;
    const modifyDate = parsedExif.ModifyDate ? String(parsedExif.ModifyDate) : null;

    extraStrings = [software, make ?? '', model ?? '', String(parsedExif.DigitalSourceType ?? '')];

    exifSummary = {
      width,
      height,
      format,
      make,
      model,
      software: software || null,
      dateTimeOriginal: dateOriginal,
      modifyDate,
      elaMeanDelta,
      elaMaxDelta,
      hasCameraHardwareTags: Boolean(make || model),
    };

    const lowerSoft = software.toLowerCase();
    const matchedEditor = EDITING_SOFTWARE_MARKERS.find((m) => lowerSoft.includes(m));
    if (matchedEditor) {
      provenanceFindings.push({
        whatDetected: `Optional editing/generator tag found ("${software}")`,
        whereDetected: 'EXIF / XMP Software Header',
        whyFlagged: `Embedded metadata names "${software}". This is recorded as optional provenance context alongside pixel content checks.`,
        analysisMethod: 'Optional EXIF / XMP Header Check',
        confidence: 75,
        limitations:
          'Software tags indicate export tool history (such as cropping or color adjustments) and do not override visual pixel analysis.',
        classification: 'Inconclusive',
        regionJson: null,
      });
    }
  }

  const provenance: ProvenanceScanResult = scanBufferProvenance(buffer, extraStrings);
  if (provenance.hasWatermarkMarkers) {
    provenanceFindings.push({
      whatDetected: `AI generator provenance marker detected (${provenance.aiGeneratorSignatures.join(', ')})`,
      whereDetected: 'Optional C2PA / IPTC / PNG Metadata Chunk',
      whyFlagged: `Optional header scan found ${provenance.provenanceSummary}`,
      analysisMethod: 'Optional C2PA / Watermark Metadata Scanner',
      confidence: 90,
      limitations:
        'Embedded metadata can be stripped or altered; content-based pixel and frequency checks remain primary.',
      classification: 'Suspicious',
      regionJson: null,
    });
  }

  const combinedMetadata: Record<string, unknown> = {
    ...exifSummary,
    fftMetrics,
    noiseMetrics,
    provenance,
  };

  const ai = getGeminiClient();
  if (!ai) {
    return buildFallbackSignalResult({
      reason: 'GEMINI_API_KEY is not configured.',
      elaUrl,
      combinedMetadata,
      fftMetrics,
      noiseMetrics,
      provenance,
      contentFindings,
      provenanceFindings,
    });
  }

  try {
    const promptText = `Inspect the visual content and measured signals of "${filename}" (${width}x${height}, ${format}) and classify it as REAL, AI-GENERATED, or INCONCLUSIVE.
${caseDescription ? `Context: "${caseDescription}"\n` : ''}Signals: FFT=${JSON.stringify(fftMetrics)}; Noise=${JSON.stringify(noiseMetrics)}; ELA_mean=${elaMeanDelta}, max=${elaMaxDelta}; Provenance(optional)=${provenance.provenanceSummary}.
Rules:
1. Judge primarily from visual content (skin pores, hair, eyes/glasses reflections, clothing, background geometry, lighting, motion blur, hands/anatomy), even if EXIF/watermarks are missing or the photo was compressed by messaging/social apps.
2. Note: Standard JPEG/social compression naturally creates 8x8 DCT grid harmonics in FFT and strips EXIF—NEVER classify a natural camera photo as AI-GENERATED or INCONCLUSIVE merely due to JPEG compression or missing EXIF.
3. NEVER classify as REAL or AI-GENERATED solely because metadata is missing.
4. Return concise JSON: 2-sentence plain-English technicalSummary and 1 to 3 findings (under 25 words per field) with 0-100% region boxes where visible.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        detectionLabel: {
          type: Type.STRING,
          description: 'Exactly "REAL", "AI-GENERATED", or "INCONCLUSIVE".',
        },
        aiProbability: {
          type: Type.INTEGER,
          description: '0-100 integer likelihood of AI generation.',
        },
        confidence: {
          type: Type.INTEGER,
          description: '0-100 calibrated certainty integer.',
        },
        technicalSummary: {
          type: Type.STRING,
          description: 'Concise 2-sentence plain-English summary.',
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
              region: {
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

    const imageParts = [
      {
        inlineData: {
          mimeType: geminiPayloadMime,
          data: geminiPayloadBuffer.toString('base64'),
        },
      },
      { text: promptText },
    ];

    let usedModel = GEMINI_FAST_MODEL;
    let response;
    try {
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_MODEL,
            contents: { parts: imageParts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction:
                'You are a fast, accurate image forensics classifier. Judge carefully from visual content: natural smartphone/camera photos (even WhatsApp/social compressed) should be classified as REAL with low aiProbability unless clear synthetic or edited artifacts are visible.',
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 0, timeoutMs: 14_000, label: 'Fast image visual check' }
      );
    } catch {
      usedModel = GEMINI_MODEL;
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: { parts: imageParts },
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                'You are a fast, accurate image forensics classifier. Judge carefully from visual content: natural smartphone/camera photos (even WhatsApp/social compressed) should be classified as REAL with low aiProbability unless clear synthetic or edited artifacts are visible.',
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 1, timeoutMs: 22_000, label: 'Image visual check' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const rawLabel = String(parsed.detectionLabel || '').toUpperCase();
    let detectionLabel: ImageDetectionLabel =
      rawLabel === 'AI-GENERATED'
        ? 'AI-GENERATED'
        : rawLabel === 'REAL'
        ? 'REAL'
        : 'INCONCLUSIVE';

    if (provenance.hasWatermarkMarkers && detectionLabel === 'INCONCLUSIVE') {
      detectionLabel = 'AI-GENERATED';
    }

    const aiProbability = Math.max(0, Math.min(100, Math.round(Number(parsed.aiProbability ?? 50))));
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 55))));

    const classification: ForensicClassification =
      detectionLabel === 'AI-GENERATED'
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
          whatDetected: String(f.whatDetected || 'Visual pattern observation'),
          whereDetected: String(f.whereDetected || 'Image frame'),
          whyFlagged: String(f.whyFlagged || 'Visual and frequency inspection finding.'),
          analysisMethod: `Content Visual + 2D-FFT + Pixel Noise Analysis (${usedModel})`,
          confidence: Math.max(0, Math.min(100, Number(f.confidence ?? confidence))),
          limitations: String(
            f.limitations ||
              'Visual and spectral analysis is probabilistic; heavy social-media compression or cropping can mask fine pixel details.'
          ),
          classification: validClassifications.includes(f.classification)
            ? f.classification
            : classification,
          regionJson:
            f.region &&
            typeof f.region.x === 'number' &&
            typeof f.region.y === 'number' &&
            typeof f.region.width === 'number' &&
            typeof f.region.height === 'number'
              ? {
                  x: Math.max(0, Math.min(100, f.region.x)),
                  y: Math.max(0, Math.min(100, f.region.y)),
                  width: Math.max(2, Math.min(100, f.region.width)),
                  height: Math.max(2, Math.min(100, f.region.height)),
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
        parsed.technicalSummary || 'Visual, pixel noise, and 2D-FFT spectral checks completed.'
      ),
      elaUrl,
      metadata: {
        ...combinedMetadata,
        detectionLabel,
        aiProbability,
      },
      findings: [...aiFindings, ...contentFindings, ...provenanceFindings],
    };
  } catch (error) {
    const errMsg = formatGeminiError(error);
    return buildFallbackSignalResult({
      reason: errMsg,
      elaUrl,
      combinedMetadata,
      fftMetrics,
      noiseMetrics,
      provenance,
      contentFindings,
      provenanceFindings,
    });
  }
}

