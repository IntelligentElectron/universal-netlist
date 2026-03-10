/**
 * Creates a promise-chain mutex that serializes async operations.
 * Each call queues the provided function and waits for prior calls to complete.
 * Errors are isolated — one rejection doesn't block subsequent calls.
 */
export const createMutex = (): (<T>(fn: () => Promise<T>) => Promise<T>) => {
  let chain: Promise<void> = Promise.resolve();

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.then(fn);
    chain = result.then(
      () => {},
      () => {}
    );
    return result;
  };
};
