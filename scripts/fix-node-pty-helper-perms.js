const fs = require('fs')
const path = require('path')

if (process.platform !== 'darwin') process.exit(0)

const helpers = [
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
]

for (const helperPath of helpers) {
  if (!fs.existsSync(helperPath)) continue
  const stat = fs.statSync(helperPath)
  const nextMode = stat.mode | 0o111
  if (nextMode !== stat.mode) {
    fs.chmodSync(helperPath, nextMode)
  }
}
