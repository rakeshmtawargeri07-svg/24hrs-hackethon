import { User } from 'firebase/auth';

const TRANSIENT_STATUSES = new Set([502, 503, 504]);

function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('err_connection') ||
    msg.includes('fetch')
  );
}

async function pingHealth(): Promise<'ok' | 'auth_redirect' | 'warming' | 'down'> {
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect') {
      return 'auth_redirect';
    }
    if (!res.ok) {
      return 'warming';
    }
    const text = await res.text();
    const parsed = JSON.parse(text);
    return parsed?.ok ? 'ok' : 'warming';
  } catch (err) {
    return isNetworkFailure(err) ? 'down' : 'warming';
  }
}

export async function ensureServerReady(maxWaitMs = 12_000): Promise<'ok' | 'auth_redirect' | 'timeout'> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await pingHealth();
    if (status === 'ok') return 'ok';
    if (status === 'auth_redirect') return 'auth_redirect';
    await new Promise((r) => setTimeout(r, 700));
  }
  return 'timeout';
}

export async function apiFetch<T>(
  user: User,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await user.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);

    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let res: Response | null = null;
    let netErr: unknown = null;

    try {
      res = await fetch(url, {
        ...options,
        headers,
        redirect: 'manual',
      });
    } catch (err) {
      netErr = err;
    }

    if (res?.type === 'opaqueredirect') {
      throw new Error(
        'Your preview session expired. Please click the Reload icon (↻) at the top of the preview bar, then run your check again.'
      );
    }

    const hitTransientGateway = res && TRANSIENT_STATUSES.has(res.status);
    let rawText = '';
    let isHtmlWarmup = false;

    if (res && !hitTransientGateway) {
      rawText = await res.text();
      const contentType = res.headers.get('content-type') || '';
      const trimmed = rawText.trimStart();
      isHtmlWarmup =
        contentType.includes('text/html') ||
        trimmed.startsWith('<!DOCTYPE') ||
        trimmed.startsWith('<html');
    }

    if (netErr || hitTransientGateway || isHtmlWarmup) {
      if (attempt < maxAttempts - 1) {
        const readiness = await ensureServerReady(12_000);
        if (readiness === 'auth_redirect') {
          throw new Error(
            'Your preview session expired. Please click the Reload icon (↻) at the top of the preview bar, then run your check again.'
          );
        }
        if (readiness === 'ok') {
          continue;
        }
      }

      if (netErr) {
        const msg = netErr instanceof Error ? netErr.message : 'Network error';
        if (isNetworkFailure(netErr)) {
          throw new Error(
            'Could not reach the analysis server after waiting for it to reconnect. Please reload the preview (↻) and try again.'
          );
        }
        throw new Error(msg);
      }

      throw new Error(
        'The analysis server is still restarting. Please wait a moment and click Run Check again.'
      );
    }

    if (!res) {
      throw new Error('Could not reach the analysis server. Please retry.');
    }

    let data: any = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        throw new Error('Server returned an unexpected response while restarting. Please retry.');
      }
    }

    if (!res.ok) {
      throw new Error(data?.error || `Request failed with status ${res.status}`);
    }

    return data as T;
  }

  throw new Error('Could not reach the analysis server. Please retry.');
}
