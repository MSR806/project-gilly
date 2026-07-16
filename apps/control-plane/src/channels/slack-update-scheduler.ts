export type SlackUpdateTarget = {
  channel: string;
  ts: string;
};

export type SlackUpdateScheduler<T extends SlackUpdateTarget> = {
  schedule(update: T): void;
  flush(channel: string, ts: string): Promise<void>;
  finalize(update: T): Promise<void>;
  cancel(channel: string, ts: string): Promise<void>;
};

type Waiter = {
  ignoreError: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type Entry<T> = {
  pending?: T;
  inFlight: boolean;
  closing: boolean;
  closed: boolean;
  error?: unknown;
  waiters: Waiter[];
};

type SchedulerOptions<T> = {
  send: (update: T) => Promise<unknown>;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (error: unknown, update: T) => void;
};

const DEFAULT_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 10_000;
const MAX_CLOSED_TARGETS = 1_000;

function targetKey(channel: string, ts: string) {
  return `${channel}\u0000${ts}`;
}

function objectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function secondsToMs(value: unknown): number | undefined {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1_000;
}

export function slackRetryAfterMs(error: unknown): number | undefined {
  const direct = secondsToMs(objectValue(error, "retryAfter"));
  if (direct !== undefined) return direct;

  const data = objectValue(error, "data");
  const fromData = secondsToMs(objectValue(data, "retry_after"));
  if (fromData !== undefined) return fromData;

  const headers =
    objectValue(error, "headers") ?? objectValue(objectValue(error, "response"), "headers");
  if (headers instanceof Headers) return secondsToMs(headers.get("retry-after"));
  return secondsToMs(objectValue(headers, "retry-after") ?? objectValue(headers, "Retry-After"));
}

function isRateLimited(error: unknown) {
  if (slackRetryAfterMs(error) !== undefined) return true;
  const code = objectValue(error, "code");
  const status = objectValue(error, "statusCode") ?? objectValue(error, "status");
  const dataError = objectValue(objectValue(error, "data"), "error");
  return (
    status === 429 || code === "slack_webapi_rate_limited_error" || dataError === "ratelimited"
  );
}

export function createSlackUpdateScheduler<T extends SlackUpdateTarget>(
  options: SchedulerOptions<T>,
): SlackUpdateScheduler<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  const entries = new Map<string, Entry<T>>();
  const closedTargets = new Set<string>();
  const ready = new Map<string, true>();
  let worker: Promise<void> | undefined;
  let nextSendAt = 0;
  let backoffMs = intervalMs;

  const entryFor = (key: string) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        inFlight: false,
        closing: false,
        closed: false,
        waiters: [],
      };
      entries.set(key, entry);
    }
    return entry;
  };

  const rememberClosed = (key: string) => {
    closedTargets.add(key);
    if (closedTargets.size <= MAX_CLOSED_TARGETS) return;
    const oldest = closedTargets.values().next().value;
    if (oldest !== undefined) closedTargets.delete(oldest);
  };

  const settle = (key: string, entry: Entry<T>) => {
    if (entry.pending || entry.inFlight) return;
    if (entry.closing) {
      entry.closed = true;
      entries.delete(key);
      rememberClosed(key);
    }
    for (const waiter of entry.waiters.splice(0)) {
      if (entry.error !== undefined && !waiter.ignoreError) waiter.reject(entry.error);
      else waiter.resolve();
    }
  };

  const waitForDrain = (key: string, entry: Entry<T>, ignoreError = false) =>
    new Promise<void>((resolve, reject) => {
      entry.waiters.push({ ignoreError, resolve, reject });
      settle(key, entry);
    });

  const runWorker = async () => {
    while (ready.size > 0) {
      const key = ready.keys().next().value;
      if (key === undefined) return;
      const pacingDelay = Math.max(0, nextSendAt - now());
      if (pacingDelay > 0) await sleep(pacingDelay);

      ready.delete(key);
      const entry = entries.get(key);
      const update = entry?.pending;
      if (!entry || !update || entry.closed) continue;
      entry.pending = undefined;

      entry.inFlight = true;
      try {
        await options.send(update);
        entry.error = undefined;
        backoffMs = intervalMs;
        nextSendAt = now() + intervalMs;
      } catch (error) {
        if (isRateLimited(error)) {
          const retryAfter = slackRetryAfterMs(error);
          const delay = retryAfter ?? backoffMs;
          if (retryAfter === undefined) backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          nextSendAt = now() + delay;
          if (!entry.pending) entry.pending = update;
          ready.set(key, true);
        } else {
          entry.error = error;
          nextSendAt = now() + intervalMs;
          try {
            options.onError?.(error, update);
          } catch {
            // Diagnostics must not stop the scheduler worker.
          }
        }
      } finally {
        entry.inFlight = false;
        settle(key, entry);
      }
    }
  };

  const ensureWorker = () => {
    if (worker) return;
    worker = runWorker().finally(() => {
      worker = undefined;
      if (ready.size > 0) ensureWorker();
    });
  };

  const schedule = (update: T) => {
    const key = targetKey(update.channel, update.ts);
    if (closedTargets.has(key)) return;
    const entry = entryFor(key);
    if (entry.closing || entry.closed || entry.error !== undefined) return;
    entry.pending = update;
    ready.set(key, true);
    ensureWorker();
  };

  const flush = (channel: string, ts: string) => {
    const key = targetKey(channel, ts);
    const entry = entries.get(key);
    if (!entry) return Promise.resolve();
    ensureWorker();
    return waitForDrain(key, entry);
  };

  const finalize = (update: T) => {
    const key = targetKey(update.channel, update.ts);
    if (closedTargets.has(key)) {
      return Promise.reject(new Error("Slack update target is already finalized"));
    }
    const entry = entryFor(key);
    if (entry.closing || entry.closed) {
      return Promise.reject(new Error("Slack update target is already finalized"));
    }
    entry.error = undefined;
    entry.closing = true;
    entry.pending = update;
    ready.set(key, true);
    ensureWorker();
    return waitForDrain(key, entry);
  };

  const cancel = (channel: string, ts: string) => {
    const key = targetKey(channel, ts);
    const entry = entries.get(key);
    if (!entry) return Promise.resolve();
    entry.closing = true;
    entry.pending = undefined;
    ready.delete(key);
    return waitForDrain(key, entry, true);
  };

  return { schedule, flush, finalize, cancel };
}
