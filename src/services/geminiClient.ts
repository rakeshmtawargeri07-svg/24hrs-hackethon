import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;

export const GEMINI_MODEL = 'gemini-4-hydrogen';
export const GEMINI_FAST_MODEL = 'gemini-3.1-flash-lite';

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'AI request'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: { maxRetries?: number; timeoutMs?: number; label?: string } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 1;
  const timeoutMs = options.timeoutMs ?? 22_000;
  const label = options.label ?? 'Gemini analysis';

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await withTimeout(fn(controller.signal), timeoutMs + 500, label);
    } catch (error: any) {
      lastError = error;
      const msg = String(error?.message || '');
      const status = error?.status ?? error?.code;
      const isTimeout = msg.includes('timed out') || error?.name === 'AbortError';
      const isRetryable = !isTimeout && (status === 429 || status === 503 || status === 500);
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delayMs = 350 * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      clearTimeout(abortTimer);
    }
  }
  throw lastError;
}

export function parseGeminiJson<T = Record<string, any>>(rawText: string | undefined): T {
  const cleaned = (rawText ?? '{}')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned || '{}') as T;
}

export function formatGeminiError(error: unknown): string {
  const err = error as any;
  const msg = err?.message || String(error);
  if (msg.includes('API_KEY_INVALID') || err?.status === 400 || err?.status === 403) {
    return 'Gemini API key is missing or invalid in Settings > Secrets.';
  }
  if (err?.status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Gemini API quota temporarily exceeded. Retry shortly.';
  }
  if (msg.includes('timed out') || err?.name === 'AbortError') {
    return 'AI visual model timed out; pixel and spectral measurements were completed.';
  }
  return `Gemini reasoning service unavailable (${msg.slice(0, 140)}).`;
}
