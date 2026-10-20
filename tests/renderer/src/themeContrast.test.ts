import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_IDS_IN_UI_ORDER } from '../../../src/shared/types'

// Text keeps its readability floor; line roles keep the restrained values
// chosen and verified on the rendered surfaces. Light tokens live in the
// top-level :root; dark tokens in @media (prefers-color-scheme: dark).
const css = readFileSync(resolve('src/renderer/src/styles.css'), 'utf8')

type Rgb = [number, number, number]

function themeBlock(theme: 'light' | 'dark'): string {
  if (theme === 'light') {
    const start = css.search(/^:root\s*\{/m)
    return css.slice(css.indexOf('{', start), css.indexOf('\n}', start))
  }
  const media = css.indexOf('@media (prefers-color-scheme: dark) {')
  expect(media, 'the dark theme must be a prefers-color-scheme block').toBeGreaterThanOrEqual(0)
  const start = css.indexOf('  :root {', media)
  return css.slice(css.indexOf('{', start), css.indexOf('\n  }', start))
}

function tokenValue(block: string, token: string): string {
  const value = block.match(new RegExp(`${token.replaceAll('-', '\\-')}\\s*:\\s*([^;]+);`))?.[1]?.trim()
  expect(value, `${token} must be defined`).toBeTruthy()
  return value!
}

function hexOf(block: string, token: string): Rgb {
  const value = tokenValue(block, token)
  expect(value, `${token} must be an opaque six-digit hex color`).toMatch(/^#[0-9a-f]{6}$/i)
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as Rgb
}

function mix(color: Rgb, base: Rgb, amount: number): Rgb {
  return color.map((channel, index) => channel * amount + base[index]! * (1 - amount)) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const SURFACES = ['--app-bg', '--bg-primary', '--bg-secondary', '--bg-surface', '--bg-input', '--task-kept-bg', '--floating-bg']
const INKS = ['--text-primary', '--text-secondary', '--text-muted', '--accent', '--success', '--error', '--warning']
// What each pane carries: the column, prompt, and welcome panes carry labels,
// empty states, warnings, and each column's enqueue text; the metadata strip
// carries its toggle and the model name; the preview well its placeholder.
const PANE_INKS: Record<string, string[]> = {
  '--pane-bg': ['--text-primary', '--text-secondary', '--text-muted', '--warning', '--error', ...BACKEND_IDS_IN_UI_ORDER.map((backend) => `--backend-${backend}-text`)],
  '--pane-bg-strong': ['--text-primary', '--text-secondary', '--text-muted', '--accent'],
  '--preview-bg': ['--text-primary', '--text-secondary'],
}
const FILLS = ['--accent', '--accent-hover', '--success', '--error', '--error-hover', '--warning', ...BACKEND_IDS_IN_UI_ORDER.map((backend) => `--backend-${backend}`)]

// Each check returns the pairs below its floor, so one run lists them all and a
// planted block can show that it finds them.
function shortfalls(pairs: Array<[ink: Rgb, background: Rgb, label: string]>): string[] {
  return pairs.flatMap(([ink, background, label]) => {
    const ratio = contrast(ink, background)
    return ratio < 4.5 ? [`${label}: ${ratio.toFixed(2)}`] : []
  })
}

function surfaceShortfalls(block: string): string[] {
  return shortfalls([
    ...INKS.flatMap((ink) => SURFACES.map((surface) => [hexOf(block, ink), hexOf(block, surface), `${ink} on ${surface}`] as [Rgb, Rgb, string])),
    [hexOf(block, '--text-primary'), hexOf(block, '--bg-hover'), '--text-primary on --bg-hover'],
    ...BACKEND_IDS_IN_UI_ORDER.map((backend) =>
      [hexOf(block, `--backend-${backend}-text`), hexOf(block, '--bg-surface'), `${backend} text on --bg-surface`] as [Rgb, Rgb, string]),
  ])
}

function paneShortfalls(block: string): string[] {
  return shortfalls(Object.entries(PANE_INKS).flatMap(([pane, inks]) =>
    inks.map((ink) => [hexOf(block, ink), hexOf(block, pane), `${ink} on ${pane}`] as [Rgb, Rgb, string])))
}

function fillShortfalls(block: string): string[] {
  const onAccent = hexOf(block, '--text-on-accent')
  const pairs: Array<[Rgb, Rgb, string]> = FILLS.map((fill) => [onAccent, hexOf(block, fill), `--text-on-accent on ${fill}`])
  pairs.push([onAccent, mix(hexOf(block, '--accent'), [0, 0, 0], 0.8), '--text-on-accent on the darkened accent'])
  for (const status of ['--error', '--warning', '--success']) {
    // Main-window notices tint the pane they sit on; toasts tint the floating surface.
    for (const surface of ['--bg-surface', '--bg-secondary', '--bg-primary', '--pane-bg', '--floating-bg']) {
      // The strongest tint a status badge uses is 14% (the dependency badges).
      pairs.push([hexOf(block, status), mix(hexOf(block, status), hexOf(block, surface), 0.14), `${status} on its tint over ${surface}`])
    }
  }
  // A destructive trigger rests on an 8% error tint and deepens it to 18% under
  // the pointer, so its letters are read on the deeper one too.
  for (const amount of [0.08, 0.18]) {
    pairs.push([hexOf(block, '--error'), mix(hexOf(block, '--error'), hexOf(block, '--bg-surface'), amount), `--error on its ${amount * 100}% tint`])
  }
  // The informational notice: secondary text on a 10% accent tint over the pane.
  pairs.push([hexOf(block, '--text-secondary'), mix(hexOf(block, '--accent'), hexOf(block, '--pane-bg'), 0.1), 'info notice text'])
  for (const tag of ['amber', 'blue']) {
    pairs.push([hexOf(block, `--tag-${tag}-text`), mix(hexOf(block, `--tag-${tag}`), hexOf(block, '--bg-secondary'), 0.14), `${tag} tag`])
  }
  return shortfalls(pairs)
}

/** The block with one token set to another token's value. */
function planted(block: string, token: string, valueOf: string): string {
  return block.replace(new RegExp(`(${token.replaceAll('-', '\\-')}\\s*:\\s*)[^;]+;`), `$1${tokenValue(block, valueOf)};`)
}

describe('theme token contrast', () => {
  for (const theme of ['light', 'dark'] as const) describe(`${theme} theme`, () => {
    const block = themeBlock(theme)

    it(`keeps text at 4.5:1 or more on the opaque surfaces in the ${theme} theme`, () => {
      expect(surfaceShortfalls(block)).toEqual([])
    })

    it(`keeps text at 4.5:1 or more on the panes in the ${theme} theme`, () => {
      expect(paneShortfalls(block)).toEqual([])
    })

    it(`keeps text on filled controls and tinted notices at 4.5:1 or more in the ${theme} theme`, () => {
      expect(fillShortfalls(block)).toEqual([])
    })

    it(`finds an ink planted on its own background in the ${theme} theme`, () => {
      expect(surfaceShortfalls(planted(block, '--text-muted', '--bg-primary'))).toContain('--text-muted on --bg-primary: 1.00')
      expect(paneShortfalls(planted(block, '--warning', '--pane-bg'))).toContain('--warning on --pane-bg: 1.00')
      expect(fillShortfalls(planted(block, '--text-on-accent', '--accent'))).toContain('--text-on-accent on --accent: 1.00')
    })
  })

  // CIEDE2000, for telling the backend accents apart (see QueueColumn.css).
  function lab([r, g, b]: Rgb): [number, number, number] {
    const [lr, lg, lb] = [r, g, b].map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }) as Rgb
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const fx = f((lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047)
    const fy = f(lr * 0.2126 + lg * 0.7152 + lb * 0.0722)
    const fz = f((lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883)
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
  }

  function deltaE(first: Rgb, second: Rgb): number {
    const [l1, a1, b1] = lab(first)
    const [l2, a2, b2] = lab(second)
    const rad = Math.PI / 180
    const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
    const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)))
    const [ap1, ap2] = [(1 + g) * a1, (1 + g) * a2]
    const [cp1, cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)]
    const hue = (a: number, b: number) => (Math.atan2(b, a) / rad + 360) % 360
    const [hp1, hp2] = [hue(ap1, b1), hue(ap2, b2)]
    let dh = hp2 - hp1
    if (cp1 * cp2 === 0) dh = 0
    else if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
    const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad)
    const lBar = (l1 + l2) / 2
    const cpBar = (cp1 + cp2) / 2
    let hBar = hp1 + hp2
    if (cp1 * cp2 !== 0) hBar = Math.abs(hp1 - hp2) > 180 ? (hBar + 360) / 2 : hBar / 2
    const t = 1 - 0.17 * Math.cos((hBar - 30) * rad) + 0.24 * Math.cos(2 * hBar * rad) + 0.32 * Math.cos((3 * hBar + 6) * rad) - 0.2 * Math.cos((4 * hBar - 63) * rad)
    const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2)
    const sC = 1 + 0.045 * cpBar
    const sH = 1 + 0.015 * cpBar * t
    const rT = -Math.sin(2 * 30 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad) * 2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7))
    return Math.sqrt(((l2 - l1) / sL) ** 2 + ((cp2 - cp1) / sC) ** 2 + (dH / sH) ** 2 + rT * ((cp2 - cp1) / sC) * (dH / sH))
  }

  function accentClashes(block: string): string[] {
    const accents = BACKEND_IDS_IN_UI_ORDER.map((backend) => [backend, hexOf(block, `--backend-${backend}`)] as const)
    return accents.flatMap(([name, color], index) => [
      ...accents.slice(index + 1)
        .filter(([, otherColor]) => deltaE(color, otherColor) < 20)
        .map(([other]) => `${name} and ${other}`),
      // The residual floor band the dark set was accepted at: never a status
      // color's twin, since every column also carries its backend's name.
      ...['--success', '--warning', '--error']
        .filter((status) => deltaE(color, hexOf(block, status)) < 8)
        .map((status) => `${name} and ${status}`),
    ])
  }

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps the backend accents apart from each other and from the status colors in the ${theme} theme`, () => {
      expect(accentClashes(themeBlock(theme))).toEqual([])
    })

    it(`finds a backend accent planted on another's or a status color in the ${theme} theme`, () => {
      const [first, second] = BACKEND_IDS_IN_UI_ORDER
      const block = themeBlock(theme)
      expect(accentClashes(planted(block, `--backend-${second}`, `--backend-${first}`))).toContain(`${first} and ${second}`)
      expect(accentClashes(planted(block, `--backend-${first}`, '--error'))).toContain(`${first} and --error`)
    })
  }

  it('defines every light color token again in the dark block', () => {
    const tokens = (block: string) => new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*(?:#|\d+%)/g)].map((match) => match[1]))
    const dark = tokens(themeBlock('dark'))
    for (const token of tokens(themeBlock('light'))) expect(dark.has(token), `${token} in the dark theme`).toBe(true)
  })

  it('references only defined tokens', () => {
    const dir = resolve('src/renderer/src/components')
    const sheets = [css, ...readdirSync(dir).filter((file) => file.endsWith('.css')).map((file) => readFileSync(join(dir, file), 'utf8'))]
    const all = sheets.join('\n')
    // --iq-column-width is set inline from the persisted layout at runtime.
    const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).concat('--iq-column-width'))
    for (const [, token] of all.matchAll(/var\((--[a-z0-9-]+)/g)) expect(defined.has(token), `${token} is defined`).toBe(true)
  })
})
