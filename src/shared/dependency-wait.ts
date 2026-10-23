// Acquisition waits match their cooperative abort deadlines. The persistent
// controller still owns a late result; these are not physical lifetime limits.
export const DEPENDENCY_WAIT_MS = {
  cli: 4 * 60 * 60 * 1000,
  recommendations: 3 * 60 * 1000,
  check: 3 * 60 * 1000,
  toggle: 30_000,
} as const
export const DEPENDENCY_CANCEL_WAIT_MS = 30_000
