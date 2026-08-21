export type RetryOptions = {
  attempts?: number;
  delay?: (attempt: number) => Promise<void>;
};

export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      await (options.delay ?? defaultDelay)(attempt);
    }
  }
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|connection reset|econnreset|network|\b429\b|\b5\d\d\b/i.test(message);
}

async function defaultDelay(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
}
