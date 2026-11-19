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
  if (stylometry.aiPhraseHits.length > 0) {
    const hitCount = stylometry.aiPhraseHits.length;
    deterministicFindings.push({
      whatDetected: `Common LLM phrasing / template markers (${hitCount} match${hitCount === 1 ? '' : 'es'})`,
      whereDetected: filename,
      whyFlagged: `Matched high-probability AI template phrasing: "${stylometry.aiPhraseHits.slice(0, 5).join('", "')}".`,
      analysisMethod: 'Deterministic Stylometry & Phrase Matcher',
      confidence: Math.min(88, 52 + hitCount * 14),
      limitations:
        'Polite business/email phrases can also appear in human-written templates; combine with linguistic predictability analysis.',
      classification: hitCount >= 2 ? 'Suspicious' : 'Inconclusive',
      regionJson: null,
    });
  }

  if (stylometry.lowReliabilityShortText) {
    deterministicFindings.push({
      whatDetected: `Ultra-short snippet (${stylometry.wordCount} words, ${stylometry.sentenceCount} sentence(s))`,
      whereDetected: filename,
      whyFlagged:
        'Snippets under 15 words have minimal statistical structure, so detection relies on phrasing cues.',
      analysisMethod: 'Statistical Text Reliability Guard',
      confidence: 45,
      limitations:
        'Very short fragments can be ambiguous without surrounding paragraph context.',
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
    const promptText = `Analyze this text (${filename}, ${stylometry.wordCount} words, ${stylometry.sentenceCount} sentences) for AI-generated authorship signals, LLM phrasing patterns, and internal/contextual inconsistencies.
${caseDescription ? `Context / accompanying media notes: "${caseDescription}"\n` : ''}
Computed Deterministic Stylometric Metrics:
${JSON.stringify(stylometry)}

Text content:
"""
${sampleText}
"""

Tasks:
1. Evaluate linguistic predictability (low perplexity / safe default next-token phrasing), generic LLM politeness/template formulas (e.g., "I hope you're doing well", "regarding an important matter", "look forward to your response", "thank you for your time and consideration", or formal essay transitions), uniform cadence, lack of concrete personal/situational details, and any contradictions against context notes.
2. Classify into one of:
   - "AI-GENERATED" (aiProbability 65-98): Strong LLM phrasing, generic template smoothness, predictable structure, or absence of authentic human specificity—even in short 1-paragraph emails, captions, or statements.
   - "AI-ASSISTED" (aiProbability 42-64): Mixed AI structure with human edits or moderate template overlap.
   - "HUMAN-WRITTEN" (aiProbability 2-39): Natural human voice, concrete details, idiosyncratic rhythm, or organic imperfections.
   - "INCONCLUSIVE" (aiProbability 40-60): Use ONLY when the text is genuinely ambiguous or an ultra-short fragment (< 15 words) with no clear cues either way. Do NOT default a clear AI-written paragraph to "INCONCLUSIVE" just because it is under 60 words.
3. Set "aiProbability" (0-100) and calibrated "confidence" (0-100).
4. Quote exact short excerpts from the text for key findings, and write "technicalSummary" in 2-3 clear, plain-English sentences.`;

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
      'You are an expert computational linguistics and AI-authorship forensics analyst. Accurately distinguish authentic human writing from LLM-generated paragraphs, emails, essays, and transcripts by inspecting token predictability, generic template clichés, specificity vs. vagueness, and sentence cadence. Never falsely downgrade a clear AI-generated paragraph to Inconclusive solely for being a single paragraph.';

    let usedModel = GEMINI_MODEL;
    let response;
    try {
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: promptText,
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 1, timeoutMs: 22_000, label: 'Primary AI text detection' }
      );
    } catch {
      usedModel = GEMINI_FAST_MODEL;
      response = await withRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_MODEL,
            contents: promptText,
            config: {
              abortSignal,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        { maxRetries: 0, timeoutMs: 14_000, label: 'Fallback AI text detection' }
      );
    }

    const parsed = parseGeminiJson<any>(response.text);
    const rawLabel = String(parsed.detectionLabel || '').toUpperCase();
    let aiProbability = Math.max(0, Math.min(100, Math.round(Number(parsed.aiProbability ?? 50))));
    let confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 65))));

    // Reconcile deterministic AI phrase hits with LLM score if text matches multiple strong LLM clichés
    if (stylometry.aiPhraseHits.length >= 2 && aiProbability < 68) {
      aiProbability = Math.max(aiProbability, Math.min(84, 58 + stylometry.aiPhraseHits.length * 8));
    }

    let detectionLabel: TextDetectionLabel =
      rawLabel === 'AI-GENERATED'
        ? 'AI-GENERATED'
        : rawLabel.includes('ASSISTED') || rawLabel.includes('EDITED')
        ? 'AI-ASSISTED'
        : rawLabel.includes('HUMAN')
        ? 'HUMAN-WRITTEN'
        : 'INCONCLUSIVE';

    // Ensure probability and label stay consistent
    if (aiProbability >= 65 && detectionLabel === 'INCONCLUSIVE') {
      detectionLabel = 'AI-GENERATED';
    } else if (aiProbability <= 32 && detectionLabel === 'INCONCLUSIVE' && !stylometry.lowReliabilityShortText) {
      detectionLabel = 'HUMAN-WRITTEN';
    }

    // Only apply a mild confidence ceiling on ultra-short (<15 word) fragments
    if (stylometry.lowReliabilityShortText && confidence > 70) {
      confidence = 65;
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
              'Linguistic AI detection provides probabilistic indicators; heavily paraphrased or human-edited drafts can blur boundaries.'
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
