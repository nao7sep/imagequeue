// Flattens an Error (or any thrown value) into a plain, fully-serializable
// object capturing type, message, stack, and the cause chain — not just
// `.message` — so a failure can be reconstructed from a log line alone. Pure
// and dependency-free so both the Electron main process (the logger) and the
// renderer (forwarding errors over IPC) produce identical structured errors.
//
// Total by construction: the cause chain is walked with a `seen` set so a
// circular chain (`err.cause === err`, or mutual A↔B) is collapsed to a marker
// instead of overflowing the stack. A non-Error value that is an object is
// embedded under `value` rather than stringified to "[object Object]"; the
// logger's redactor scrubs any secrets and breaks any cycles when it serializes
// that value.
function serializeErrorInner(err: unknown, seen: Set<unknown>): Record<string, unknown> {
  if (err instanceof Error) {
    if (seen.has(err)) {
      return { name: err.name, message: err.message, circular: true }
    }
    seen.add(err)
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack ?? null,
    }
    if (err.cause !== undefined) {
      out.cause = serializeErrorInner(err.cause, seen)
    }
    return out
  }
  if (err !== null && typeof err === 'object') {
    // A non-Error object was thrown/rejected (some SDKs reject with plain
    // objects carrying status/body). Keep its fields; redaction and cycle
    // handling happen downstream in the logger's redactor.
    const name = (err as { constructor?: { name?: string } }).constructor?.name ?? 'Object'
    return { name, value: err }
  }
  return { name: typeof err, message: String(err) }
}

export function serializeError(err: unknown): Record<string, unknown> {
  return serializeErrorInner(err, new Set())
}
