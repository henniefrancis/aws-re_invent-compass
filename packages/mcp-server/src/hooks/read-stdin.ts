// Reads the hook input from stdin (Requirement 18.4): at most `maxBytes` bytes and `timeoutMs`
// milliseconds. Anything over either limit returns undefined, so the hook fails open. Bytes
// that are not valid UTF-8 are decoded with replacement characters and fail JSON parsing later.

/** The limits from the requirements: 1 MiB and 5 seconds. */
export const STDIN_LIMITS = { maxBytes: 1048576, timeoutMs: 5000 } as const;

/** Limits for a stdin read. */
export interface StdinLimits {
  maxBytes: number;
  timeoutMs: number;
}

/** Reads all of `stream` as text, or returns undefined when it is too large or too slow. */
export async function readStdin(
  stream: AsyncIterable<Uint8Array>,
  limits: StdinLimits = STDIN_LIMITS,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined);
    }, limits.timeoutMs);
  });
  const read = (async (): Promise<string | undefined> => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > limits.maxBytes) {
        return undefined;
      }
      chunks.push(chunk);
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
