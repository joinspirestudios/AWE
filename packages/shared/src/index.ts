/**
 * @app/shared
 *
 * Cross-cutting utilities used by both the app and other packages.
 * Add things here when they're needed in two or more places.
 */

/** Stable URL-safe id. Prefers crypto.randomUUID() when available. */
export function generateId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${rand}`
}

/** Clamp a number to [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** Assert at the type level that something is unreachable. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected: ${JSON.stringify(x)}`)
}
