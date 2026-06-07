const fs = require('fs')
const path = require('path')

// node-pty ships a prebuilt `spawn-helper` executable, but npm extraction can
// drop its exec bit, which makes pty spawns fail with EACCES at runtime (the
// Draw Things import jobs use a pty). Restore the bit here. macOS only —
// Windows node-pty uses conpty/winpty and has no spawn-helper.
if (process.platform !== 'darwin') process.exit(0)

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (!fs.existsSync(prebuildsDir)) process.exit(0) // node-pty not installed

// Discover every spawn-helper under prebuilds/ rather than hardcoding the
// per-arch paths, so an arch addition or layout change doesn't silently skip it.
function findSpawnHelpers(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findSpawnHelpers(full))
    else if (entry.name === 'spawn-helper') found.push(full)
  }
  return found
}

const helpers = findSpawnHelpers(prebuildsDir)
if (helpers.length === 0) {
  // node-pty is installed but ships no spawn-helper where we look — its prebuild
  // layout has likely changed. Warn loudly here rather than let pty spawns fail
  // with an opaque EACCES at runtime; the path in this script needs revisiting.
  console.warn(`[fix-node-pty-helper-perms] node-pty present but no spawn-helper found under ${prebuildsDir}`)
  process.exit(0)
}

for (const helperPath of helpers) {
  const stat = fs.statSync(helperPath)
  const nextMode = stat.mode | 0o111
  if (nextMode !== stat.mode) {
    fs.chmodSync(helperPath, nextMode)
  }
}
