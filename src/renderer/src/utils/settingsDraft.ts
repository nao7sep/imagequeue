type Settings = Record<string, unknown>

const isRecord = (value: unknown): value is Settings =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The Settings form's draft after the stored settings changed while it was
 *  open: each value the user has not edited, still equal to the settings the
 *  form started from, takes the stored one, and each edit stays. */
export function rebaseSettingsDraft(base: Settings, draft: Settings, stored: Settings): Settings {
  const next: Settings = {}
  for (const key of new Set([...Object.keys(stored), ...Object.keys(draft)])) {
    const [from, edited, now] = [base[key], draft[key], stored[key]]
    const value = isRecord(from) && isRecord(edited) && isRecord(now)
      ? rebaseSettingsDraft(from, edited, now)
      : same(edited, from) ? now : edited
    if (value !== undefined) next[key] = value
  }
  return next
}
