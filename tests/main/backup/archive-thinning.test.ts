import { describe, expect, it } from 'vitest'
import { archivesToThin } from '../../../src/main/backup/archive-thinning'

// The data-lifecycle-conventions' fixed schedule for full-copy archives.

const now = new Date('2026-10-01T12:00:00.000Z')
const DAY = 86_400_000

function name(time: number): string {
  const iso = new Date(time).toISOString()
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}-${iso.slice(20, 23)}-utc.zip`
}

function daysAgo(days: number, hour = 0): string {
  return name(now.getTime() - days * DAY + hour * 3_600_000)
}

describe('archivesToThin', () => {
  it('keeps every copy younger than 21 days', () => {
    const names = [daysAgo(0, -1), daysAgo(1), daysAgo(1, 1), daysAgo(20.5), daysAgo(20.5, 1)]
    expect(archivesToThin(names, now)).toEqual([])
  })

  it('keeps the last copy of each UTC day from 21 to 90 days', () => {
    const morning = name(Date.UTC(2026, 7, 15, 8))
    const evening = name(Date.UTC(2026, 7, 15, 20))
    const nextDay = name(Date.UTC(2026, 7, 16, 8))
    expect(archivesToThin([nextDay, morning, evening, daysAgo(0)], now)).toEqual([morning])
  })

  it('keeps the last copy of each ISO week from 90 days to 1,095 days', () => {
    // 2026-03-02 is a Monday and 2026-03-08 the Sunday of the same ISO week.
    const monday = name(Date.UTC(2026, 2, 2, 12))
    const sunday = name(Date.UTC(2026, 2, 8, 12))
    const nextMonday = name(Date.UTC(2026, 2, 9, 12))
    expect(archivesToThin([monday, sunday, nextMonday, daysAgo(0)], now)).toEqual([monday])
  })

  it('reads the ISO week across a year boundary', () => {
    // 2024-12-30 (Monday) and 2025-01-05 (Sunday) are both in ISO week 2025-W1.
    const monday = name(Date.UTC(2024, 11, 30, 12))
    const sunday = name(Date.UTC(2025, 0, 5, 12))
    expect(archivesToThin([monday, sunday, daysAgo(0)], now)).toEqual([monday])
  })

  it('keeps the last copy of each calendar month after 1,095 days, forever', () => {
    const early = name(Date.UTC(2022, 4, 2))
    const late = name(Date.UTC(2022, 4, 30))
    const june = name(Date.UTC(2022, 5, 1))
    const older = name(Date.UTC(2015, 0, 10))
    expect(archivesToThin([early, late, june, older, daysAgo(0)], now)).toEqual([early])
  })

  it('counts days exactly at each boundary', () => {
    const justInside = name(now.getTime() - 21 * DAY + 1)
    const minuteLater = name(now.getTime() - 21 * DAY + 60_000)
    expect(archivesToThin([justInside, minuteLater], now)).toEqual([])
    const atBoundary = name(now.getTime() - 21 * DAY)
    expect(archivesToThin([atBoundary, minuteLater], now)).toEqual([atBoundary])
  })

  it('never deletes the newest copy, however old', () => {
    const newest = name(Date.UTC(2020, 0, 2))
    const older = name(Date.UTC(2020, 0, 1))
    expect(archivesToThin([older, newest], now)).toEqual([older])
  })

  it('leaves a name it cannot read', () => {
    expect(archivesToThin(['notes.zip', daysAgo(400), daysAgo(0)], now)).toEqual([])
  })
})
