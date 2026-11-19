import { ThinkingLevel, Type } from '@google/genai';
import { EvidenceModality, ForensicClassification } from '../../db/schema.ts';
import {
  GEMINI_FAST_MODEL,
  GEMINI_MODEL,
  formatGeminiError,
  getGeminiClient,
  parseGeminiJson,
  withRetry,
} from '../geminiClient.ts';

export interface EvidenceCorrelationInput {
  id: number;
  modality: EvidenceModality;
  filename: string;
  classification: ForensicClassification;
  confidence: number;
  technicalSummary: string;
  extractedText?: string | null;
  metadataJson: Record<string, unknown>;
}

export interface CrossModalCorrelationRecord {
  pairType:
    | 'audio_video_sync'
    | 'lip_speech_consistency'
    | 'video_transcript'
    | 'image_video_similarity'
    | 'cross_source_contradiction';
  title: string;
  sourceEvidenceIds: number[];
  findingSummary: string;
  consistencyStatus: ForensicClassification;
  confidence: number;
  limitations: string;
}

export interface InvestigationSynthesisResult {
  overallAssessment: ForensicClassification;
  overallConfidence: number;
  summary: string;
  limitations: string;
  recommendations: string[];
  correlations: CrossModalCorrelationRecord[];
}

export async function correlateInvestigationEvidence(params: {
  title: string;
  description: string;
  items: EvidenceCorrelationInput[];
}): Promise<InvestigationSynthesisResult> {
  const { title, description, items } = params;

  const hasSuspicious = items.some((i) => i.classification === 'Suspicious');
  const allUnavailable =
    items.length > 0 && items.every((i) => i.classification === 'Analysis Unavailable');

  if (items.length === 0) {
    return {
      overallAssessment: 'Inconclusive',
      overallConfidence: 0,
      summary: 'No evidence items were attached to this case.',
      limitations: 'At least one media or text file is required to run detection.',
      recommendations: ['Upload an image, video, audio, or text file to begin analysis.'],
      correlations: [],
    };
  }

  // Fast path: single-file checks have no cross-file pairs to correlate — avoid a redundant LLM round-trip
  if (items.length === 1) {
    const item = items[0];
    const detectionLabel =
      typeof item.metadataJson?.detectionLabel === 'string'
        ? item.metadataJson.detectionLabel
        : null;
    const aiProb =
      typeof item.metadataJson?.aiProbability === 'number'
        ? item.metadataJson.aiProbability
        : null;
    const labelPhrase = detectionLabel
      ? `${detectionLabel}${aiProb !== null ? ` (AI probability ${aiProb}%)` : ''}`
      : item.classification;

    return {
      overallAssessment: item.classification,
      overallConfidence: item.confidence,
      summary: `${item.filename} (${item.modality}) was assessed as ${labelPhrase}. ${item.technicalSummary}`,
      limitations:
        'Only one file was submitted, so cross-file checks (audio-video sync, lip-speech match, or text comparison) do not apply. Probabilistic signal and visual analysis can be affected by heavy compression, cropping, or re-encoding.',
      recommendations: [
        'Review the highlighted signal metrics and explanation in the Inspect Files tab.',
        'Upload the original unedited file if available to reduce compression loss.',
        'Add related video, audio, or text files to run cross-file consistency checks.',
      ],
      correlations: [],
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      overallAssessment: allUnavailable
        ? 'Analysis Unavailable'
        : hasSuspicious
        ? 'Suspicious'
        : 'Inconclusive',
      overallConfidence: 0,
      summary:
        'Signal-level extraction completed, while AI cross-file synthesis is unavailable because GEMINI_API_KEY is not configured.',
      limitations: 'Cross-file AI synthesis requires server-side Gemini API access.',
      recommendations: [
        'Configure GEMINI_API_KEY in Settings > Secrets to enable full AI detection.',
        'Review extracted frequency, noise, MFCC, and stylometry metrics directly.',
      ],
      correlations: [],
    };
  }

  const digest = items.map((item) => {
    const cleanMeta = { ...item.metadataJson };
    delete cleanMeta.keyframes;
    delete cleanMeta.waveformPeaks;
    return {
      evidenceId: item.id,
      modality: item.modality,
      filename: item.filename,
      detectionLabel: cleanMeta.detectionLabel ?? null,
      aiProbability: cleanMeta.aiProbability ?? null,
      classification: item.classification,
      confidence: item.confidence,
      summary: item.technicalSummary,
      extractedTextOrTranscript: item.extractedText ? item.extractedText.slice(0, 4000) : null,
      contentSignals: {
        fftMetrics: cleanMeta.fftMetrics ?? null,
        noiseMetrics: cleanMeta.noiseMetrics ?? null,
        temporalSignals: cleanMeta.temporalSignals ?? null,
        stylometry: cleanMeta.stylometry ?? null,
        spectralCentroidHz: cleanMeta.spectralCentroidHz ?? null,
        spectralFlatness: cleanMeta.spectralFlatness ?? null,
      },
      optionalProvenance: cleanMeta.provenance ?? null,
    };
  });

  try {
    const promptText = `Synthesize this multimodal AI-generated content check titled "${title}".
Context notes: "${description || 'None provided'}"

Files (${items.length} total):
${JSON.stringify(digest, null, 2)}

Perform Cross-Modal Correlation across the available files:
- Compare audio and video synchronisation (pairType: "audio_video_sync") if both audio and video exist.
- Compare lip movement and speech consistency (pairType: "lip_speech_consistency") if video and speech/audio exist.
- Compare video content and transcript/document consistency (pairType: "video_transcript") if video and text/transcript exist.
- Compare image and video evidence similarities (pairType: "image_video_similarity") if image and video exist.
- Identify contradictions between any sources (pairType: "cross_source_contradiction") whenever 2+ items exist.

CRITICAL RULES:
1. Base synthesis on CONTENT-LEVEL signals (visual, temporal, spectral/MFCC, linguistic/stylometry). NEVER classify content as real or AI-generated solely because EXIF metadata, watermarks, or C2PA Content Credentials are absent.
2. Only emit correlations for pairs actually present. Never invent contradictions.
3. Write summary, limitations, and recommendations in clear, concise, everyday English (2-3 short sentences for summary; 1-2 short sentences for limitations; 3 short 1-sentence recommendations). Never include raw JSON field names in prose.
4. Return calibrated overallAssessment ("Suspicious", "No Significant Indicators Detected", "Inconclusive", or "Analysis Unavailable") and overallConfidence (0-100).`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        overallAssessment: { type: Type.STRING },
        overallConfidence: { type: Type.INTEGER },
        summary: { type: Type.STRING },
        limitations: { type: Type.STRING },
        recommendations: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        correlations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pairType: { type: Type.STRING },
              title: { type: Type.STRING },
              sourceEvidenceIds: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
              },
              findingSummary: { type: Type.STRING },
              consistencyStatus: { type: Type.STRING },
              confidence: { type: Type.INTEGER },
              limitations: { type: Type.STRING },
            },
          },
        },
      },
    };
    const sysPrompt =
      'You are a lead AI content detection synthesizer. Focus on content-based visual, temporal, acoustic, and linguistic evidence across files. Write in clear plain English without raw variable names, and never treat missing metadata as proof either way.';

    let response;
    try {
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_MODEL,
            contents: promptText,
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 0, timeoutMs: 14_000, label: 'Fast cross-check synthesis' }
      );
    } catch {
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: promptText,
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 1, timeoutMs: 20_000, label: 'Cross-check synthesis' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const validClassifications: ForensicClassification[] = [
      'Suspicious',
      'No Significant Indicators Detected',
      'Inconclusive',
      'Analysis Unavailable',
    ];
    const validPairTypes = [
      'audio_video_sync',
      'lip_speech_consistency',
      'video_transcript',
      'image_video_similarity',
      'cross_source_contradiction',
    ] as const;

    const overallAssessment: ForensicClassification = validClassifications.includes(
      parsed.overallAssessment
    )
      ? parsed.overallAssessment
      : hasSuspicious
      ? 'Suspicious'
      : 'Inconclusive';

    const correlations: CrossModalCorrelationRecord[] = Array.isArray(parsed.correlations)
      ? parsed.correlations.map((c: any) => ({
          pairType: validPairTypes.includes(c.pairType) ? c.pairType : 'cross_source_contradiction',
          title: String(c.title || 'Cross-File Consistency Check'),
          sourceEvidenceIds: Array.isArray(c.sourceEvidenceIds)
            ? c.sourceEvidenceIds.filter((n: any) => typeof n === 'number')
            : items.map((i) => i.id),
          findingSummary: String(c.findingSummary || 'Cross-file comparison completed.'),
          consistencyStatus: validClassifications.includes(c.consistencyStatus)
            ? c.consistencyStatus
            : 'Inconclusive',
          confidence: Math.max(0, Math.min(100, Number(c.confidence ?? 50))),
          limitations: String(
            c.limitations || 'Cross-file comparison relies on extracted signals and summaries.'
          ),
        }))
      : [];

    return {
      overallAssessment,
      overallConfidence: Math.max(0, Math.min(100, Number(parsed.overallConfidence ?? 55))),
      summary: String(parsed.summary || 'Multimodal content analysis completed.'),
      limitations: String(
        parsed.limitations ||
          'Content-based AI detection provides probabilistic indicators and should be reviewed by a human before making high-stakes decisions.'
      ),
      recommendations:
        Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
          ? parsed.recommendations.map(String)
          : [
              'Review highlighted regions, timestamps, or excerpts alongside the AI probability score.',
              'Check original source files if available, especially for heavily compressed media.',
            ],
      correlations,
    };
  } catch (error) {
    const errMsg = formatGeminiError(error);
    return {
      overallAssessment: hasSuspicious ? 'Suspicious' : 'Inconclusive',
      overallConfidence: 0,
      summary: `Individual file analyses are stored, while cross-file synthesis failed: ${errMsg}`,
      limitations: 'Cross-file synthesis could not run due to an upstream model error.',
      recommendations: [
        'Inspect each uploaded file individually in the Case Results tabs.',
        'Click Re-check Consistency once the AI service recovers.',
      ],
      correlations: [],
    };
  }
}
