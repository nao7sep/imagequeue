// Electron entry for label-fit.mjs. CommonJS on purpose: Electron holds its
// ready event until the entry finishes evaluating, so an ESM entry awaiting
// app work at top level would deadlock. Prints one JSON line of problems.

const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')

const job = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'))

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function page(testCase) {
  const items = testCase.items
    .map((item) => `<${item.tag} class="${item.className}">${escape(item.text)}</${item.tag}>`)
    .join('')
  return `<!doctype html><html lang="${testCase.language}"><head><meta charset="utf-8"><style>${job.styles}</style></head>
<body><div class="modal-backdrop"><div class="modal-box ${testCase.box ?? ''}">
<div class="modal-header"><h2>Title</h2></div><div class="modal-body"></div>
<div class="modal-footer">${items}</div></div></div></body></html>`
}

// Runs in the page. A footer label must stay on one line whenever it fits a
// row; only a label wider than the whole row may wrap, and then its button
// grows to hold it. Nothing may leave the footer on either side.
const MEASURE = `(() => {
  const issues = []
  const footer = document.querySelector('.modal-footer')
  const box = document.querySelector('.modal-box').getBoundingClientRect()
  const edge = footer.getBoundingClientRect()
  const style = getComputedStyle(footer)
  const row = footer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  if (box.left < 0 || box.right > window.innerWidth) issues.push('dialog is wider than the window (' + Math.round(box.width) + ' px)')
  for (const element of footer.children) {
    const rect = element.getBoundingClientRect()
    if (rect.left < edge.left - 0.5) issues.push('"' + element.textContent + '" spills past the left edge')
    if (rect.right > edge.right + 0.5) issues.push('"' + element.textContent + '" spills past the right edge')
    if (element.tagName !== 'BUTTON') continue
    if (element.scrollHeight > element.clientHeight + 1) issues.push('"' + element.textContent + '" overflows its button')
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
    if (lines > 1) {
      const twin = element.cloneNode(true)
      Object.assign(twin.style, { whiteSpace: 'nowrap', maxWidth: 'none', position: 'absolute', visibility: 'hidden' })
      document.body.appendChild(twin)
      const natural = twin.getBoundingClientRect().width
      twin.remove()
      if (natural <= row + 0.5) issues.push('"' + element.textContent + '" wraps although it fits a row')
    }
  }
  return issues
})()`

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: job.viewport.width,
    height: job.viewport.height,
    useContentSize: true,
    show: false,
    webPreferences: { offscreen: true },
  })
  const problems = []
  for (const testCase of job.cases) {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(testCase)))
    for (const issue of await window.webContents.executeJavaScript(MEASURE)) {
      problems.push({ footer: testCase.footer, language: testCase.language, issue })
    }
  }
  process.stdout.write(JSON.stringify(problems) + '\n')
  app.quit()
})
