// Deterministic Statistical & Stylometric Text Feature Extractor

export interface TextStylometryMetrics {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  sentenceLengthStd: number;
  sentenceLengthCv: number; // Coefficient of variation (std / mean)
  burstiness: number; // [-1..1]; higher = more human-like length variation
  typeTokenRatio: number; // lexical diversity
  hapaxRatio: number; // words appearing exactly once / total words
  bigramRepetitionRate: number;
  trigramRepetitionRate: number;
  sentenceStarterDiversity: number;
  aiTransitionDensity: number; // per 100 words
  aiPhraseHits: string[];
  isShortPassage: boolean;
  lowReliabilityShortText: boolean;
}

const COMMON_AI_PHRASES = [
  // Essay / formal LLM transitions & buzzwords
  'moreover',
  'furthermore',
  'additionally',
  'in conclusion',
  'it is important to note',
  'it is worth noting',
  "it's worth noting",
  'in summary',
  'on the other hand',
  'delve into',
  'testament to',
  'tapestry of',
  'multifaceted',
  'pivotal role',
  'underscores the importance',
  'comprehensive overview',
  'ever-evolving landscape',
  'foster innovation',
  'streamline',
  'in today\'s fast-paced',
  // Conversational / email / outreach LLM clichés
  "hope you're doing well",
  'hope you are doing well',
  'hope this email finds you well',
  'hope this message finds you well',
  'wanted to connect with you',
  'regarding an important matter',
  'look forward to your response',
  'looking forward to hearing from you',
  'thank you for your time and consideration',
  'thanks for your time and consideration',
  'please do not hesitate to reach out',
  "don't hesitate to reach out",
  'feel free to reach out',
  'please let me know if you have any questions',
  'at your earliest convenience',
  'i would be happy to assist',
  'as an ai',
];

export function analyzeTextStylometry(rawText: string): TextStylometryMetrics {
  const cleaned = rawText.replace(/\s+/g, ' ').trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const words = (cleaned.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(Boolean);
  const wordCount = words.length;
  const sentenceCount = sentences.length;

  const sentenceLengths = sentences.map((s) => (s.match(/[a-zA-Z0-9']+/g) ?? []).length);
  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 0;
  const variance =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((acc, l) => acc + Math.pow(l - avgSentenceLength, 2), 0) /
        sentenceLengths.length
      : 0;
  const sentenceLengthStd = Math.sqrt(variance);
  const sentenceLengthCv =
    avgSentenceLength > 0 ? sentenceLengthStd / avgSentenceLength : 0;
  const burstiness =
    sentenceLengthStd + avgSentenceLength > 0
      ? (sentenceLengthStd - avgSentenceLength) / (sentenceLengthStd + avgSentenceLength)
      : 0;

  // Lexical diversity & Hapax Legomena
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const uniqueWords = freq.size;
  let hapaxCount = 0;
  for (const count of freq.values()) {
    if (count === 1) hapaxCount++;
  }
  const typeTokenRatio = wordCount > 0 ? uniqueWords / wordCount : 0;
  const hapaxRatio = wordCount > 0 ? hapaxCount / wordCount : 0;

  // Bigram & Trigram repetition rates
  const bigrams = new Set<string>();
  let totalBigrams = 0;
  const trigrams = new Set<string>();
  let totalTrigrams = 0;

  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
    totalBigrams++;
    if (i < words.length - 2) {
      trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      totalTrigrams++;
    }
  }

  const bigramRepetitionRate =
    totalBigrams > 0 ? Math.max(0, 1 - bigrams.size / totalBigrams) : 0;
  const trigramRepetitionRate =
    totalTrigrams > 0 ? Math.max(0, 1 - trigrams.size / totalTrigrams) : 0;

  // Sentence starter diversity
  const starters = new Set(
    sentences
      .map((s) => (s.toLowerCase().match(/^[a-z0-9']+/)?.[0] ?? ''))
      .filter(Boolean)
  );
  const sentenceStarterDiversity = sentenceCount > 0 ? starters.size / sentenceCount : 0;

  // Common AI transition & template phrase density
  const lower = cleaned.toLowerCase();
  let transitionHits = 0;
  const aiPhraseHits: string[] = [];
  for (const phrase of COMMON_AI_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = lower.match(new RegExp(`\\b${escaped}\\b`, 'g'));
    if (matches && matches.length > 0) {
      transitionHits += matches.length;
      aiPhraseHits.push(phrase);
    }
  }
  const aiTransitionDensity = wordCount > 0 ? (transitionHits / wordCount) * 100 : 0;

  return {
    wordCount,
    sentenceCount,
    avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
    sentenceLengthStd: Number(sentenceLengthStd.toFixed(1)),
    sentenceLengthCv: Number(sentenceLengthCv.toFixed(3)),
    burstiness: Number(burstiness.toFixed(3)),
    typeTokenRatio: Number(typeTokenRatio.toFixed(3)),
    hapaxRatio: Number(hapaxRatio.toFixed(3)),
    bigramRepetitionRate: Number(bigramRepetitionRate.toFixed(3)),
    trigramRepetitionRate: Number(trigramRepetitionRate.toFixed(3)),
    sentenceStarterDiversity: Number(sentenceStarterDiversity.toFixed(3)),
    aiTransitionDensity: Number(aiTransitionDensity.toFixed(2)),
    aiPhraseHits,
    isShortPassage: wordCount < 60 || sentenceCount < 3,
    lowReliabilityShortText: wordCount < 15 || sentenceCount < 1,
  };
}
