import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest, onRouteHookHandler, RouteOptions } from 'fastify';
import type { RateLimitOptions as PluginRateLimitOptions, RateLimitPluginOptions } from '@fastify/rate-limit';

export interface RateLimiter {
  /** Returns true if the request is allowed, false if it should be blocked. */
  check(key: string): boolean;
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  /**
   * Hard cap on tracked keys. Keys are attacker-chosen (any string on the
   * wire, any address behind the proxy), so without a cap the map is a
   * memory sink; at the cap the oldest window is evicted, which can only
   * ever forget a counter, never lock anyone out (#109).
   */
  maxKeys?: number;
  now?: () => number;
}

export const DEFAULT_MAX_KEYS = 10_000;

interface WindowEntry { count: number; resetAt: number }

/**
 * Fixed-window counters with a hard size cap. Every window has the same
 * length, so insertion order IS expiry order: `open` re-inserts the key at the
 * back, expired entries are swept from the front, and when the cap is reached
 * the front (earliest-expiring, live) entry is evicted — all amortised O(1),
 * with no full-map sweep an attacker could trigger per request.
 */
function windowMap(windowMs: number, maxKeys: number) {
  const entries = new Map<string, WindowEntry>();
  return {
    /** The live entry for `key`, dropping it if its window has passed. */
    live(key: string, t: number): WindowEntry | undefined {
      const e = entries.get(key);
      if (!e) return undefined;
      if (t >= e.resetAt) {
        entries.delete(key);
        return undefined;
      }
      return e;
    },
    /** Starts a fresh window for `key` with one hit, evicting to stay under the cap. */
    open(key: string, t: number): WindowEntry {
      entries.delete(key);
      for (const [k, e] of entries) {
        if (t < e.resetAt && entries.size < maxKeys) break;
        entries.delete(k);
      }
      const e = { count: 1, resetAt: t + windowMs };
      entries.set(key, e);
      return e;
    },
    delete(key: string): void {
      entries.delete(key);
    },
  };
}

/**
 * Minimal in-memory fixed-window limiter — no dependency, fits the project's
 * memory-store idiom. Intended for the small set of auth endpoints, keyed by
 * client IP.
 */
export function fixedWindowLimiter({ max, windowMs, maxKeys = DEFAULT_MAX_KEYS, now = () => Date.now() }: RateLimitOptions): RateLimiter {
  const hits = windowMap(windowMs, maxKeys);
  return {
    check(key) {
      const t = now();
      const e = hits.live(key, t);
      if (!e) {
        hits.open(key, t);
        return true;
      }
      if (e.count >= max) return false;
      e.count++;
      return true;
    },
  };
}

/**
 * Limiters for the public POST /comments route (comments spec decision 6):
 * 5 per IP per 15 min and 200 per hour process-wide. Each call builds FRESH
 * maps — never share them with the login limiter, or a comment flood would
 * lock the admin out of /login (and vice versa).
 */
export function commentLimiters(now?: () => number): { ip: RateLimiter; global: RateLimiter } {
  return {
    ip: fixedWindowLimiter({ max: 5, windowMs: 900_000, ...(now ? { now } : {}) }),
    global: fixedWindowLimiter({ max: 200, windowMs: 3_600_000, maxKeys: 1, ...(now ? { now } : {}) }),
  };
}

/** Fastify preHandler that 429s when the per-IP limiter is exhausted. */
export function rateLimitPreHandler(limiter: RateLimiter) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void | FastifyReply> => {
    if (!limiter.check(req.ip)) {
      // Return the refusal through async onSend work; see AuthGuard in authn.ts.
      return reply.code(429).send({ error: 'too many attempts, please wait and try again' });
    }
  };
}

/**
 * Per-account failure limiter. The key is whatever identifies the account at
 * the call site: the submitted username on /login, the session's user id on
 * /users/me/password (the caller is already authenticated there). Failures
 * are counted across ALL sources — this is the defence against a brute force
 * spread over many addresses, which the per-IP limiter cannot see. Its
 * flip side is that anyone who can reach the budget can lock the account, so
 * the /login budget is set well above what one address can spend (#109).
 */
export interface AccountLimiter {
  /** Returns true if the account is locked due to excessive failed attempts. */
  isLocked(account: string): boolean;
  /** Records a failed attempt for the account. */
  recordFailure(account: string): void;
  /** Clears failures on a successful attempt for the account. */
  recordSuccess(account: string): void;
}

/**
 * Longest account key stored verbatim. Anything longer is stored as `#` +
 * SHA-256 hex: 65 characters, so it can never equal a verbatim key.
 */
export const MAX_KEY_LENGTH = 64;

/**
 * In-memory account lockout limiter: `max` failures inside one window lock the
 * account until the window ends. Bounded in key COUNT like `fixedWindowLimiter`
 * and in key LENGTH by hashing over-long accounts, so a 1 MiB username costs the
 * map 64 characters, while an account that really has such a name (created
 * before #109 capped them) keeps its own lockout budget.
 */
export function accountLockoutLimiter({ max = 5, windowMs = 900_000, maxKeys = DEFAULT_MAX_KEYS, now = () => Date.now() }: Partial<RateLimitOptions> = {}): AccountLimiter {
  const failures = windowMap(windowMs, maxKeys);
  const normalize = (u: string) => {
    const key = u.toLowerCase().trim();
    return key.length <= MAX_KEY_LENGTH ? key : `#${createHash('sha256').update(key).digest('hex')}`;
  };
  return {
    isLocked(username) {
      if (!username) return false;
      const entry = failures.live(normalize(username), now());
      return entry !== undefined && entry.count >= max;
    },
    recordFailure(username) {
      if (!username) return;
      const key = normalize(username);
      const t = now();
      const entry = failures.live(key, t);
      if (entry) entry.count++;
      else failures.open(key, t);
    },
    recordSuccess(username) {
      if (!username) return;
      failures.delete(normalize(username));
    },
  };
}

const NO_RATE_LIMIT_HEADERS = { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false } as const;

/**
 * Options for every `@fastify/rate-limit` registration (#619). The plugin is
 * registered only inside child scopes whose every route is limited (see
 * SECURITY.md, Rate limiting), never on the root instance. `global: false`:
 * a registration limits nothing by itself. Allowed responses gain no header;
 * a refusal carries `Retry-After` only.
 */
export const RATE_LIMIT_PLUGIN_OPTIONS: RateLimitPluginOptions = {
  global: false,
  addHeaders: NO_RATE_LIMIT_HEADERS,
  addHeadersOnExceeding: NO_RATE_LIMIT_HEADERS,
  errorResponseBuilder: (_req, context) => Object.assign(new Error('too many requests, please wait and try again'), { statusCode: context.statusCode }),
};

/** Per address, shared by every GPX route: an abuse ceiling, not a throttle. */
export const GPX_RATE_LIMIT = { max: 300, timeWindow: 60_000 } as const satisfies PluginRateLimitOptions;

/** Per address, for `GET /backups/:name` (its `HEAD` twin has a bucket of its own). */
export const BACKUP_DOWNLOAD_RATE_LIMIT = { max: 30, timeWindow: 60_000 } as const satisfies PluginRateLimitOptions;

/**
 * `onRoute` hook for a rate-limited scope: a route the predicate does not
 * accept fails the boot, so every route declared in the scope is limited by
 * construction. Added to a scope, it also sees routes of nested child scopes
 * and of non-encapsulated plugins registered in it.
 */
export function requireRouteLimiter(isLimited: (route: RouteOptions) => boolean, label: string): onRouteHookHandler {
  return (route) => {
    if (!isLimited(route)) throw new Error(`${[route.method].flat().join(',')} ${route.url} must be rate-limited (${label})`);
  };
}
