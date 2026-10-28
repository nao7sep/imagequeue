import fs from 'node:fs'
import path from 'node:path'
import type { Writable } from 'node:stream'
import { createCliOutputMask } from './cli-output-mask'

const HIGH_WATER_MARK = 64 * 1024

/** An optional diagnostic sink can pause its source, but cannot own its lifetime. */
export function createCliOutputWriter(
  root: string | null,
  basename: string,
  kind: 'stdout' | 'stderr',
  credentials: () => readonly string[],
  reportFailure: (error: unknown) => void = () => {},
) {
  const mask = createCliOutputMask(credentials)
  let stream: Writable | undefined
  let file: string | null = null
  let failure: unknown
  let disabled = false
  let ended = false
  let pendingWrites = 0
  let resumeSource: (() => void) | undefined
  let finishPromise: Promise<void> | undefined
  let resolveFinish: (() => void) | undefined

  const resume = (): void => {
    const callback = resumeSource
    resumeSource = undefined
    callback?.()
  }
  const detach = (): void => {
    if (root === null) {
      stream?.off('error', disable)
      stream?.off('drain', resume)
    }
  }
  const complete = (): void => { detach(); resolveFinish?.() }
  const disable = (error: unknown): void => {
    if (disabled) return
    disabled = true
    failure = error
    // Native fs.WriteStream owns pending IO and closes only after it settles.
    // Resolving this optional sink does not close its descriptor underneath IO.
    if (root !== null) stream?.destroy()
    resume()
    detach()
    reportFailure(error)
    resolveFinish?.()
  }
  const ensureStream = (): Writable => {
    if (stream) return stream
    if (root === null) stream = kind === 'stdout' ? process.stdout : process.stderr
    else {
      file = basename
      stream = fs.createWriteStream(path.join(root, basename), {
        flags: 'wx', mode: 0o600, highWaterMark: HIGH_WATER_MARK,
        fs: {
          ...fs,
          open: (filePath, flags, mode, callback) => {
            fs.mkdir(root, { recursive: true }, (error) => {
              if (error) callback(error)
              else fs.open(filePath, flags, mode, callback)
            })
          },
        },
      })
    }
    stream.on('error', disable)
    stream.on('drain', resume)
    if (root !== null) stream.once('close', () => {
      if (disabled) return
      if (!ended) { disable(new Error('CLI diagnostic output closed before completion')); return }
      resume()
      complete()
    })
    return stream
  }
  const write = (text: string, onResume?: () => void): boolean => {
    if (disabled || !text) return true
    try {
      const target = ensureStream()
      pendingWrites++
      const accepted = target.write(text, 'utf8', (error?: Error | null) => {
        pendingWrites--
        if (error) { disable(error); return }
        if (disabled) return
        if (root === null && ended && pendingWrites === 0) complete()
      })
      if (!accepted && onResume) resumeSource = onResume
      return accepted
    } catch (error) { disable(error); return true }
  }
  return {
    get file(): string | null { return file },
    get error(): unknown { return failure },
    append(text: string, onResume: () => void): boolean {
      if (ended || disabled) return true
      return write(mask.append(text), onResume)
    },
    finish(): Promise<void> {
      if (finishPromise) return finishPromise
      finishPromise = new Promise<void>((resolve) => { resolveFinish = resolve })
      write(mask.append('', true))
      ended = true
      if (!stream || disabled) complete()
      else if (root === null) {
        // Never end or destroy the process's own standard streams.
        if (pendingWrites === 0) complete()
      } else {
        stream.end()
      }
      return finishPromise
    }
  }
}
