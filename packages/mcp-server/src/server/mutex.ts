// A mutex for the write tools (QA M2). Two write calls that arrive together would each read the
// schedule, each pass the guardrail against that same schedule, and each write: a clash that the
// guardrail exists to stop. Running the write handlers one at a time, each re-reading the schedule
// when it starts, closes that gap.

/** Runs functions one at a time, in arrival order. A failure does not stop the queue. */
export interface Mutex {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** Creates a mutex. */
export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run: (task) => {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
