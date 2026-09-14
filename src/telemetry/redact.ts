/** Remove credentials before serializing tool arguments, including invalid requests. */
export const redactToolArgs = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.hasOwn(args, "password") ? { ...args, password: "[REDACTED]" } : args;
