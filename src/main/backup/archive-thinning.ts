// Which archives to delete, by age, on the data-lifecycle-conventions' fixed
// schedule. Pure: names in, names out.

const DAY_MS = 86_400_000
const ARCHIVE_NAME = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})-utc\.zip$/

function archiveTime(name: string): number | null {
  const match = ARCHIVE_NAME.exec(name)
  if (!match) return null
  const [, year, month, day, hours, minutes, seconds, ms] = match.map(Number)
  return Date.UTC(year, month - 1, day, hours, minutes, seconds, ms)
}

function isoWeek(time: number): string {
  const date = new Date(time)
  // An ISO week belongs to the year of its Thursday.
  const thursday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7))
  const year = new Date(thursday).getUTCFullYear()
  return `${year}-W${Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1}`
}

type Period = 'day' | 'week' | 'month'

function periodKeys(time: number): Record<Period, string> {
  const iso = new Date(time).toISOString()
  return { day: iso.slice(0, 10), week: isoWeek(time), month: iso.slice(0, 7) }
}

// The period whose last copy is kept at this age, or null while every copy is.
function thinnedBy(ageDays: number): Period | null {
  if (ageDays < 21) return null
  if (ageDays < 90) return 'day'
  if (ageDays < 1095) return 'week'
  return 'month'
}

/** The archives the schedule no longer keeps. A name it cannot read is kept. */
export function archivesToThin(names: readonly string[], now: Date): string[] {
  const newestFirst = names
    .map((name) => ({ name, time: archiveTime(name) }))
    .filter((archive): archive is { name: string; time: number } => archive.time !== null)
    .sort((a, b) => b.time - a.time)
  const seen: Record<Period, Set<string>> = { day: new Set(), week: new Set(), month: new Set() }
  const thinned: string[] = []
  for (const { name, time } of newestFirst) {
    const keys = periodKeys(time)
    const period = thinnedBy((now.getTime() - time) / DAY_MS)
    if (period !== null && seen[period].has(keys[period])) thinned.push(name)
    for (const each of ['day', 'week', 'month'] as const) seen[each].add(keys[each])
  }
  return thinned
}
