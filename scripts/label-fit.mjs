// label-fit: renders every dialog footer's real buttons, in every interface
// language, with the app's own stylesheets, in a hidden Electron window at the
// main window's smallest size, and reports any button that wraps its label or
// spills out of its dialog (modal-dialog-conventions, footer layout). jsdom
// cannot measure layout, so this is a hand-run check, not part of npm test.
//
//   node scripts/label-fit.mjs
//
// Footers are read from the components' `footer={…}` props. A button whose
// label depends on state (`busy ? t('a') : t('b')`) is measured with its
// longest label in each language, the worst case.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RENDERER = join(ROOT, 'src/renderer/src')
const LOCALES = join(ROOT, 'src/shared/i18n/locales')

function files(dir, suffix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path, suffix)
    return entry.name.endsWith(suffix) ? [path] : []
  })
}

// The text of a balanced `{…}` starting at `open`.
function braced(source, open) {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error('unbalanced footer')
}

const keysIn = (text) => [...text.matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)].map((match) => match[1])

function footers() {
  const out = []
  for (const file of files(RENDERER, '.tsx')) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/footer=\{/g)) {
      const body = braced(source, match.index + 'footer='.length)
      // The Modal element this footer belongs to names its box class before it.
      const before = source.slice(Math.max(0, match.index - 600), match.index)
      const box = [...before.matchAll(/className="([a-z-]+-modal-box)"/g)].pop()?.[1] ?? null
      const items = [...body.matchAll(/<(button|span)\b([\s\S]*?)>([\s\S]*?)<\/\1>/g)].flatMap((item) => {
        const className = /className=["{`]+([^"`}]*)/.exec(item[2])?.[1].replace(/\$.*/, '').trim() ?? ''
        const keys = keysIn(item[0])
        return keys.length ? [{ tag: item[1], className, keys }] : []
      })
      if (items.length) out.push({ name: `${file.slice(RENDERER.length + 1)}:${source.slice(0, match.index).split('\n').length}`, box, items })
    }
  }
  return out
}

const languages = readdirSync(LOCALES).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))
const catalogues = Object.fromEntries(languages.map((language) => [language, JSON.parse(readFileSync(join(LOCALES, `${language}.json`), 'utf8'))]))
const label = (language, keys) => keys
  .map((key) => catalogues[language][key])
  .filter((value) => typeof value === 'string')
  .sort((a, b) => b.length - a.length)[0] ?? keys[0]

const styles = ['styles.css', ...files(RENDERER, '.css').map((path) => path.slice(RENDERER.length + 1)).filter((path) => path !== 'styles.css')]
  .map((path) => readFileSync(join(RENDERER, path), 'utf8'))
  .join('\n')

const layout = readFileSync(join(ROOT, 'src/shared/layout-metrics.ts'), 'utf8')
const constant = (name) => Number(new RegExp(`${name} = (\\d+)`).exec(layout)[1])
const viewport = {
  // One pane is the narrowest main window; the height is the stacked minimum.
  width: constant('LEFT_PANE_MIN_PX') + constant('COLUMN_MIN_PX') + constant('PANE_BORDER_PX'),
  height: constant('PANE_TOOLBAR_MIN_PX') + constant('PROMPT_REGION_MIN_PX') + constant('PREVIEW_REGION_MIN_PX'),
}

const job = {
  viewport,
  styles,
  cases: footers().flatMap((footer) => languages.map((language) => ({
    footer: footer.name,
    language,
    box: footer.box,
    items: footer.items.map((item) => ({ ...item, text: label(language, item.keys) })),
  }))),
}

const work = mkdtempSync(join(tmpdir(), 'imagequeue-label-fit-'))
try {
  const input = join(work, 'job.json')
  writeFileSync(input, JSON.stringify(job))
  const electron = createRequire(import.meta.url)('electron')
  const output = execFileSync(electron, [join(ROOT, 'scripts/label-fit-main.cjs'), input], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 })
  const problems = JSON.parse(output.trim().split('\n').pop())
  console.log(`Checked ${job.cases.length} footers (${languages.length} languages) at ${viewport.width}×${viewport.height}.`)
  for (const problem of problems) console.log(`${problem.footer} [${problem.language}] ${problem.issue}`)
  if (problems.length) process.exitCode = 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
