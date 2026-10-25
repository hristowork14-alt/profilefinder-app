// Time-budget helpers so the whole search finishes well inside the function limit.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** Tracks one overall budget; each step asks how much time is left. */
export class Deadline {
  private readonly endsAt: number;

  constructor(
    totalMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.endsAt = now() + totalMs;
  }

  remaining(): number {
    return Math.max(0, this.endsAt - this.now());
  }

  /** The smaller of `ms` and what is left, minus an optional reserve for later steps. */
  budget(ms: number, reserveMs = 0): number {
    return Math.max(0, Math.min(ms, this.remaining() - reserveMs));
  }
}

/**
 * Runs `task` with an AbortSignal that fires after `ms` (or when `parent` aborts).
 * Rejects with TimeoutError on timeout. The task should pass the signal to fetch().
 */
export async function withTimeout<T>(
  label: string,
  ms: number,
  task: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  if (ms <= 0) throw new TimeoutError(label, 0);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new TimeoutError(label, ms));
      reject(new TimeoutError(label, ms));
    }, ms);
  });

  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

/** Resolves after `ms`, or rejects early if the signal aborts. Used by the mocks to simulate latency. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return signal?.aborted ? Promise.reject(signal.reason ?? new Error('aborted')) : Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}
