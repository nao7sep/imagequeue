import { ChildProcess, spawn } from 'child_process'
import net from 'net'
import { log } from '../logger'

let serverProcess: ChildProcess | null = null

function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket()
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.connect(port, '127.0.0.1')
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export async function ensureGrpcServer(cliPath: string, modelsDir?: string): Promise<boolean> {
  // If port is already open, server is running (could be gRPCServerCLI or DT app)
  if (await isPortOpen(7859)) {
    log('info', 'gRPC server already reachable at port 7859')
    return true
  }

  log('info', 'Starting gRPCServerCLI', { cliPath })
  const args: string[] = []
  if (modelsDir) args.push('--models-dir', modelsDir)

  serverProcess = spawn(cliPath, args, {
    stdio: 'pipe',
    detached: false
  })

  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    const level = /error|fail|fatal|exception/i.test(text) ? 'error' : 'info'
    log(level, 'gRPCServerCLI:', { output: text })
  })

  serverProcess.on('exit', (code) => {
    log('info', 'gRPCServerCLI exited', { code })
    serverProcess = null
  })

  // Wait up to 60 seconds for model load + server start
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if (await isPortOpen(7859)) {
      log('info', 'gRPCServerCLI ready')
      return true
    }
  }

  log('error', 'gRPCServerCLI did not become ready in time')
  return false
}

export function stopGrpcServer(): void {
  if (serverProcess) {
    log('info', 'Stopping gRPCServerCLI')
    serverProcess.kill()
    serverProcess = null
  }
}

export async function isGrpcServerReachable(): Promise<boolean> {
  return isPortOpen(7859)
}
