import { ThinkingLevel, Type } from '@google/genai';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { ForensicClassification } from '../../db/schema.ts';
import {
  GEMINI_FAST_MODEL,
  GEMINI_MODEL,
  formatGeminiError,
  getGeminiClient,
  parseGeminiJson,
  withRetry,
} from '../geminiClient.ts';
import { analyzeTextStylometry, TextStylometryMetrics } from '../signal/stylometry.ts';
import { AnalyzedFinding } from './imageForensics.ts';

export type TextDetectionLabel =
  | 'HUMAN-WRITTEN'
  | 'AI-GENERATED'
  | 'AI-ASSISTED'
  | 'INCONCLUSIVE';

export interface TextForensicResult {
  classification: ForensicClassification;
  detectionLabel: TextDetectionLabel;
  aiProbability: number;
  confidence: number;
  technicalSummary: string;
  extractedText: string;
  metadata: Record<string, unknown>;
  findings: AnalyzedFinding[];
}

export async function analyzeTextEvidence(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  caseDescription?: string;
}): Promise<TextForensicResult> {
  const { buffer, filename, mimeType, caseDescription } = params;
  const lower = filename.toLowerCase();
  let extractedText = '';
  const metadata: Record<string, unknown> = {
    filename,
    mimeType,
    fileSizeBytes: buffer.length,
  };

  try {
    if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      extractedText = text || '';
      metadata.pageCount = totalPages;
      metadata.parser = 'unpdf';
    } else if (
      lower.endsWith('.docx') ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value || '';
      metadata.parser = 'mammoth';
    } else {
      extractedText = buffer.toString('utf8');
      metadata.parser = 'utf8-plain';
    }
  } catch (err: any) {
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary: `Could not extract readable text from ${filename}: ${err?.message || 'Unsupported document structure'}.`,
      extractedText: '',
      metadata: { ...metadata, parseError: err?.message || 'Parse error' },
      findings: [
        {
          whatDetected: 'Document text extraction failed',
          whereDetected: filename,
          whyFlagged: err?.message || 'Corrupted or encrypted document file.',
          analysisMethod: 'Document Text Extractor',
          confidence: 0,
          limitations: 'Password-protected or scanned image-only PDFs without embedded text require OCR.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }

  const trimmed = extractedText.trim();
  const stylometry: TextStylometryMetrics = analyzeTextStylometry(trimmed);
  metadata.characterCount = trimmed.length;
  metadata.wordCount = stylometry.wordCount;
  metadata.stylometry = stylometry;

  if (!trimmed) {
    return {
      classification: 'Inconclusive',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 20,
      technicalSummary:
        'Document contains zero extractable text characters (possibly a scanned image-only PDF).',
      extractedText: '',
      metadata: { ...metadata, detectionLabel: 'INCONCLUSIVE', aiProbability: null },
      findings: [
        {
          whatDetected: 'No readable text layer found in document',
          whereDetected: filename,
          whyFlagged: 'Document yielded 0 readable characters after parsing.',
          analysisMethod: 'Document Text Extractor',
          confidence: 20,
          limitations: 'Image-only PDFs require OCR or upload as an image.',
          classification: 'Inconclusive',
          regionJson: null,
        },
      ],
    };
  }

  const deterministicFindings: AnalyzedFinding[] = [];
  if (stylometry.lowReliabilityShortText) {
    deterministicFindings.push({
      whatDetected: `Short text sample (${stylometry.wordCount} words, ${stylometry.sentenceCount} sentence(s))`,
      whereDetected: filename,
      whyFlagged:
        'Texts under 60 words or 3 sentences lack enough statistical structure to distinguish human writing from AI generation reliably.',
      analysisMethod: 'Statistical Text Reliability Guard',
      confidence: 35,
      limitations:
        'Short snippets, headlines, paraphrased text, and heavily edited drafts produce high false-positive/false-negative rates.',
      classification: 'Inconclusive',
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
        'Text and statistical stylometry metrics were extracted, while AI linguistic classification is unavailable because GEMINI_API_KEY is not configured.',
      extractedText: trimmed,
      metadata: { ...metadata, detectionLabel: 'INCONCLUSIVE', aiProbability: null },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'AI linguistic text detector unavailable',
          whereDetected: 'Server AI Text Pipeline',
          whyFlagged: 'GEMINI_API_KEY is missing or unconfigured.',
          analysisMethod: 'Linguistic & Stylometric AI Text Analyzer',
          confidence: 0,
          limitations: 'Configure GEMINI_API_KEY in Secrets to enable linguistic AI detection.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }

  try {
    const sampleText = trimmed.slice(0, 24000);
    const promptText = `Analyze this text (${filename}, ${stylometry.wordCount} words, ${stylometry.sentenceCount} sentences) for BOTH AI-generated authorship signals AND internal/contextual inconsistencies.
${caseDescription ? `Context / accompanying media notes: "${caseDescription}"\n` : ''}
Computed Deterministic Stylometric Metrics:
${JSON.stringify(stylometry)}

Text content:
"""
${sampleText}
"""

Tasks:
1. Evaluate linguistic predictability, uniform sentence structure (low burstiness), repetitive phrasing/transitions, generic tone, semantic consistency, and any contradictions against context notes.
2. Attempt to distinguish: "HUMAN-WRITTEN", "AI-GENERATED", "AI-ASSISTED" (mixed/edited), or "INCONCLUSIVE".
3. IMPORTANT RELIABILITY RULE: If the text is very short (< 60 words / < 3 sentences), heavily paraphrased, formulaic boilerplate (like legal/invoice templates), or ambiguous, prefer "INCONCLUSIVE" and state clearly that AI text detection cannot be guaranteed on short or edited text.
4. Set "aiProbability" (0-100) and calibrated "confidence" (0-100).
5. Quote exact short excerpts for key linguistic or contradiction findings, and write "technicalSummary" in 2-3 clear, plain-English sentences.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        detectionLabel: { type: Type.STRING },
        aiProbability: { type: Type.INTEGER },
        confidence: { type: Type.INTEGER },
        technicalSummary: { type: Type.STRING },
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
              excerpt: { type: Type.STRING },
            },
          },
        },
      },
    };
    const sysPrompt =
      'You are a fast computational linguistics and AI text detection specialist. Analyze stylometry, predictability, sentence variance, repetition, and semantic consistency honestly. Never claim 100% certainty on text detection—explicitly note short-text, paraphrasing, and human-editing limitations.';

    let usedModel = GEMINI_FAST_MODEL;
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
        { maxRetries: 0, timeoutMs: 14_000, label: 'Fast text check' }
      );
    } catch {
      usedModel = GEMINI_MODEL;
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
        { maxRetries: 1, timeoutMs: 20_000, label: 'Text check' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const rawLabel = String(parsed.detectionLabel || '').toUpperCase();
    let detectionLabel: TextDetectionLabel =
      rawLabel === 'AI-GENERATED'
        ? 'AI-GENERATED'
        : rawLabel.includes('ASSISTED') || rawLabel.includes('EDITED')
        ? 'AI-ASSISTED'
        : rawLabel.includes('HUMAN')
        ? 'HUMAN-WRITTEN'
        : 'INCONCLUSIVE';

    // Guard short text against overconfident classification
    const aiProbability = Math.max(0, Math.min(100, Math.round(Number(parsed.aiProbability ?? 50))));
    let confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 55))));
    if (stylometry.lowReliabilityShortText && confidence > 55) {
      confidence = 45;
      if (detectionLabel === 'AI-GENERATED' || detectionLabel === 'HUMAN-WRITTEN') {
        detectionLabel = 'INCONCLUSIVE';
      }
    }

    const classification: ForensicClassification =
      detectionLabel === 'AI-GENERATED'
        ? 'Suspicious'
        : detectionLabel === 'HUMAN-WRITTEN'
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
          whatDetected: String(f.whatDetected || 'Linguistic pattern observation'),
          whereDetected: String(f.whereDetected || filename),
          whyFlagged: String(f.whyFlagged || 'Stylometric or semantic pattern observed.'),
          analysisMethod: `Statistical Stylometry + Linguistic AI Text Analysis (${usedModel})`,
          confidence: Math.max(0, Math.min(100, Number(f.confidence ?? confidence))),
          limitations: String(
            f.limitations ||
              'Text detection cannot reliably prove authorship on short passages, paraphrased text, or human-edited AI drafts.'
          ),
          classification: validClassifications.includes(f.classification)
            ? f.classification
            : classification,
          regionJson: f.excerpt ? { excerpt: String(f.excerpt).slice(0, 280) } : null,
        }))
      : [];

    return {
      classification,
      detectionLabel,
      aiProbability,
      confidence,
      technicalSummary: String(
        parsed.technicalSummary || 'Linguistic, stylometric, and consistency analysis completed.'
      ),
      extractedText: trimmed,
      metadata: {
        ...metadata,
        detectionLabel,
        aiProbability,
      },
      findings: [...aiFindings, ...deterministicFindings],
    };
  } catch (error) {
    const errMsg = formatGeminiError(error);
    return {
      classification: 'Analysis Unavailable',
      detectionLabel: 'INCONCLUSIVE',
      aiProbability: 0,
      confidence: 0,
      technicalSummary: `Document text and stylometry extracted, while AI linguistic reasoning failed: ${errMsg}`,
      extractedText: trimmed,
      metadata: {
        ...metadata,
        detectionLabel: 'INCONCLUSIVE',
        aiProbability: null,
      },
      findings: [
        ...deterministicFindings,
        {
          whatDetected: 'Linguistic text analyzer unavailable',
          whereDetected: 'AI Text Pipeline',
          whyFlagged: errMsg,
          analysisMethod: 'Linguistic & Stylometric Text Analyzer',
          confidence: 0,
          limitations: 'Upstream model error prevented linguistic classification.',
          classification: 'Analysis Unavailable',
          regionJson: null,
        },
      ],
    };
  }
}
