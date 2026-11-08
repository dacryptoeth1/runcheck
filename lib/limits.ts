// In-memory, so the server must run as a single process. See DEPLOY.md.

const MAX_CONCURRENT = 2;
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 60 * 60 * 1000;
const BUSY_RETRY_SECONDS = 60;

let activeVerifications = 0;
const startsByIp = new Map<string, number[]>();

export type Admission =
  | { admitted: true; release: () => void; refund: () => void }
  | {
      admitted: false;
      status: 429 | 503;
      error: string;
      retryAfterSeconds: number;
    };

function dropExpiredStarts(now: number): void {
  for (const [ip, starts] of startsByIp) {
    const recent = starts.filter((startedAt) => now - startedAt < WINDOW_MS);
    if (recent.length > 0) {
      startsByIp.set(ip, recent);
    } else {
      startsByIp.delete(ip);
    }
  }
}

/**
 * Claims a verification slot for this IP, or says why it can't have one.
 * Call release() when the verification ends, and also refund() if it produced
 * no result, so that it doesn't count against the IP's limit.
 */
export function admitVerification(ip: string): Admission {
  const now = Date.now();
  dropExpiredStarts(now);

  const starts = startsByIp.get(ip) ?? [];
  if (starts.length >= MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((starts[0] + WINDOW_MS - now) / 1000);
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return {
      admitted: false,
      status: 429,
      error: `Rate limit reached: ${MAX_PER_WINDOW} verifications per hour. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds,
    };
  }

  if (activeVerifications >= MAX_CONCURRENT) {
    return {
      admitted: false,
      status: 503,
      error: "runcheck is busy with other verifications. Try again in a few minutes.",
      retryAfterSeconds: BUSY_RETRY_SECONDS,
    };
  }

  activeVerifications++;
  startsByIp.set(ip, [...starts, now]);

  return {
    admitted: true,
    release: () => {
      activeVerifications--;
    },
    refund: () => {
      const current = startsByIp.get(ip) ?? [];
      startsByIp.set(
        ip,
        current.filter((startedAt) => startedAt !== now),
      );
    },
  };
}
