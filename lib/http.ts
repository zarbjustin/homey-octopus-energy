'use strict';

/** Bound the whole HTTP exchange, including decoding the response body. Merely
 * timing fetch() leaves a stalled body holding a refresh lock indefinitely. */
export async function withResponseTimeout<T>(
  fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof globalThis.setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      controller.abort();
      const error = new Error('HTTP response timed out.');
      error.name = 'AbortError';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }).then(consume),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
