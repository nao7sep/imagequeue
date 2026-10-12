import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Truncation is a reviewed exception (text-cleanup-conventions, rule 4): a
// shortened value shows a marker and has a direct keyboard and touch path to
// the whole value. These lists are the reviewed sites, each with its path; a
// new site needs that review before it joins them. Any other single-line clip
// (nowrap with hidden overflow) would cut text with no marker and no path.

const REVIEWED_ELLIPSIS: Record<string, string> = {
  '.task-prompt': 'the selected task shows its full prompt in the prompt pane details',
  '.metadata-toggle-prompt': 'the toggle itself expands to the full prompt',
  '.toast-message': 'a one-word status in a window sized to it; the queue row shows the same outcome',
  'select:not([multiple])': 'opening the select shows every choice whole',
}

const REVIEWED_LINE_CLAMP: Record<string, string> = {
  '.elaborator-row-desc': 'the selected elaborator opens in its editor',
  '.records-row-text': 'the selected record shows every field in its detail pane',
}

// Not text: hidden from sight and read whole by assistive technology.
const NOT_TEXT = new Set(['.visually-hidden'])

const ROOT = process.cwd()

function sources(): Array<{ file: string; css: string }> {
  const out: Array<{ file: string; css: string }> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.css')) out.push({ file: relative(ROOT, path), css: readFileSync(path, 'utf8') })
    }
  }
  walk(join(ROOT, 'src'))
  // The toast window carries its stylesheet inline.
  const toast = readFileSync(join(ROOT, 'src/main/notification.ts'), 'utf8')
  out.push({ file: 'src/main/notification.ts', css: /<style>([\s\S]*?)<\/style>/.exec(toast)![1] })
  return out
}

function rules(css: string): Array<{ selector: string; body: string }> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\s+/g, ' '),
    body: match[2],
  }))
}

const all = sources().flatMap(({ file, css }) => rules(css).map((rule) => ({ file, ...rule })))

describe('stylesheet truncation sites', () => {
  it('draws an ellipsis only at reviewed sites', () => {
    const sites = all.filter((rule) => /text-overflow:\s*ellipsis/.test(rule.body))
    expect(sites.map((rule) => `${rule.file} ${rule.selector}`).filter((site) => !Object.keys(REVIEWED_ELLIPSIS).some((selector) => site.endsWith(` ${selector}`)))).toEqual([])
    expect(Object.keys(REVIEWED_ELLIPSIS).filter((selector) => !sites.some((rule) => rule.selector === selector)), 'reviewed but gone').toEqual([])
  })

  it('clamps lines only at reviewed sites', () => {
    const sites = all.filter((rule) => /line-clamp/.test(rule.body))
    expect(sites.map((rule) => rule.selector).filter((selector) => !(selector in REVIEWED_LINE_CLAMP))).toEqual([])
    expect(Object.keys(REVIEWED_LINE_CLAMP).filter((selector) => !sites.some((rule) => rule.selector === selector)), 'reviewed but gone').toEqual([])
  })

  it('never clips a line of text without a marker', () => {
    const unmarked = all.filter((rule) =>
      /white-space:\s*(nowrap|pre)\s*[;}]?/.test(rule.body)
      && /overflow(-x)?:\s*(hidden|clip)/.test(rule.body)
      && !/text-overflow:\s*ellipsis/.test(rule.body)
      && !NOT_TEXT.has(rule.selector))
    expect(unmarked.map((rule) => `${rule.file} ${rule.selector}`)).toEqual([])
  })
})
