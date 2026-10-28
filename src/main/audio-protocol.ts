import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { AUDIO_SCHEME } from '../shared/audio-url'
import { loadConfig } from './config'
import { resolveSettingsPath } from './utils/user-path'
import { log, serializeError } from './logger'

type SoundSlot = 'success' | 'failure'

function configuredSound(slot: SoundSlot): string | null {
  const value = loadConfig().notifications[slot === 'success' ? 'success_file' : 'failure_file']
  return value ? resolveSettingsPath(value, os.homedir()) : null
}

/** The renderer can play only the two sound files the user configured; the URL
 * names which one, and each request reads the file currently configured. */
export function loadAudioFile(filePath: string): string | null {
  if (!filePath) return null
  const requested = resolveSettingsPath(filePath, os.homedir())
  const slot = (['success', 'failure'] as const).find((candidate) => configuredSound(candidate) === requested)
  return slot ? `${AUDIO_SCHEME}://sound/${slot}` : null
}

export function registerAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    const slot = new URL(request.url).pathname.slice(1)
    const file = slot === 'success' || slot === 'failure' ? configuredSound(slot) : null
    if (!file) return new Response(null, { status: 404 })
    try {
      return await net.fetch(pathToFileURL(file).toString())
    } catch (error) {
      log('warn', 'Notification sound could not be served', { error: serializeError(error) })
      return new Response(null, { status: 404 })
    }
  })
}
