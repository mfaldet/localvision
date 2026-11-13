/**
 * Percentage change between two survey estimates, with its margin of error.
 *
 * The margin uses the U.S. Census Bureau's formula for the ratio of two
 * estimates: sqrt(m2² + (x2/x1)² · m1²) / x1, where m1 and m2 are the two
 * margins of error (at the same confidence level). Both the change and its
 * margin are in percentage points.
 *
 * Returns null when either estimate or margin is missing, or when the first
 * estimate is not positive, because no change can then be stated.
 */
export function percentChange(
  first: number | null | undefined,
  firstMargin: number | null | undefined,
  second: number | null | undefined,
  secondMargin: number | null | undefined,
): { change: number; margin: number; measurable: boolean } | null {
  if (first == null || second == null || firstMargin == null || secondMargin == null) return null
  if (!(first > 0)) return null
  const ratio = second / first
  const change = (ratio - 1) * 100
  const margin = (Math.sqrt(secondMargin ** 2 + ratio ** 2 * firstMargin ** 2) / first) * 100
  return { change, margin, measurable: Math.abs(change) > margin }
}
