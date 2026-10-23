// The IPC channel owns this pipe-based CLI's lifetime even if Electron is killed.
// Execute directly for native tests, or inline with node -e in the app bundle.
const { spawn } = require('node:child_process')
// node -e places the command at argv[1]; a direct script has its path there.
const commandIndex = __filename === '[eval]' ? 1 : 2
const command = process.argv[commandIndex]
const args = process.argv.slice(commandIndex + 1)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let closed = false
let stopping = false
let hardKillTimer

function send(message) {
  if (!process.connected) return
  // Parent loss is expected; never throw from an asynchronous send callback.
  process.send(message, (error) => { if (error) stop() })
}

const child = spawn(command, args, { stdio: ['ignore', 1, 2], env })
function stop() {
  if (closed || stopping) return
  stopping = true
  child.kill('SIGTERM')
  hardKillTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL') }, 500)
}
process.on('message', (message) => {
  if (!closed && (message?.signal === 'SIGTERM' || message?.signal === 'SIGKILL')) {
    child.kill(message.signal)
  }
})
process.on('disconnect', stop)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('spawn', () => send({ type: 'started', pid: child.pid }))
child.on('error', (error) => send({ type: 'error', message: error.message, code: error.code }))
child.on('close', (code, signal) => {
  closed = true
  clearTimeout(hardKillTimer)
  if (process.connected) {
    process.send({ type: 'exit', code, signal }, () => {
      if (process.connected) process.disconnect()
    })
  }
})
