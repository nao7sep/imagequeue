// The Draw Things backend end to end on macOS, driven through the IPC the
// renderer calls, with nothing substituted but Electron's window glue: the CLI
// and its recommendations, acquired through the app's own dependency handlers,
// and one locked model, downloaded through the CLI's own model job. Run only by
// npm run check:full, through vitest.live.config.ts.
//
// The CLI, recommendations, and model are acquired into a home that persists
// between runs and follow the app's rule: install what is missing, and update
// the CLI and recommendations only when the upstream check reports newer. The
// model is locked, so an upstream swap fails its size check instead of being
// downloaded again. Generation runs on a throwaway home where the cached tools
// and models are hard-linked.

import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../../../../src/main/config/types'
import type { CliStatusEvent } from '../../../../src/shared/cli-jobs'
import type { CliStatus, DependenciesState, DrawThingsModelParams, LocalModelInfo } from '../../../../src/shared/types'
import {
  dtFallbacksFromSettings,
  resolveDtParams,
  toDrawThingsTaskParams,
  type DtRecommendationParams,
} from '../../../../src/renderer/src/utils/drawThingsParams'
import { CACHE, PROMPT, linkTree, readOutput, requireKeys, textKey, withApp, type App } from '../live-app'

vi.mock('electron', () => import('../electron-glue'))

const TOOL_HOME = join(CACHE, 'drawthings')
// Stable Diffusion v1.5: the oldest official model in the Draw Things catalog
// and its smallest real download, locked so the lane always runs the same one.
const LOCKED_MODEL = 'sd_v1.5_f16.ckpt'
const LOCKED_MODEL_BYTES = 1_721_266_176
const MODEL_DOWNLOAD_TIMEOUT_MS = 60 * 60_000

async function waitForCliJob(app: App, jobId: string): Promise<CliStatusEvent> {
  const deadline = Date.now() + MODEL_DOWNLOAD_TIMEOUT_MS
  for (;;) {
    const status = app.contents.sent
      .filter((message) => message.channel === 'cli-job:status')
      .map((message) => message.payload as CliStatusEvent)
      .filter((event) => event.jobId === jobId)
      .at(-1)
    if (status && (status.status === 'exited' || status.status === 'killed')) return status
    if (Date.now() > deadline) {
      await app.invoke('cli-job:kill', jobId)
      throw new Error(`The ${LOCKED_MODEL} download was still running after ${MODEL_DOWNLOAD_TIMEOUT_MS} ms.`)
    }
    await delay(500)
  }
}

describe.runIf(process.platform === 'darwin')('the live Draw Things backend', () => {
  let checkFailure: string | null = null

  beforeAll(async () => {
    await mkdir(TOOL_HOME, { recursive: true })
    await withApp(TOOL_HOME, async (app) => {
      const state = () => app.invoke<DependenciesState>('dependencies:getState')
      if ((await state()).cli.state === 'not-installed') await app.invoke('dependencies:installCli')
      if ((await state()).recommendations.state === 'not-installed') {
        await app.invoke('dependencies:downloadRecommendations')
      }
      await app.invoke('dependencies:check').catch((error: unknown) => {
        checkFailure = error instanceof Error ? error.message : String(error)
      })
      if ((await state()).cli.state === 'update-available') await app.invoke('dependencies:installCli')
      if ((await state()).recommendations.state === 'update-available') {
        await app.invoke('dependencies:downloadRecommendations')
      }

      const downloaded = await app.invoke<LocalModelInfo[]>('local:listDownloadedModels')
      if (!downloaded.some((model) => model.file === LOCKED_MODEL)) {
        const jobId = await app.invoke<string>('cli-job:startDownload', LOCKED_MODEL)
        const finished = await waitForCliJob(app, jobId)
        if (finished.status !== 'exited' || finished.exitCode !== 0) {
          throw new Error(`Downloading ${LOCKED_MODEL} ended ${finished.status} with exit code ${finished.exitCode}.`)
        }
      }
    })
  })

  it('has its CLI and recommendations installed, verified, and current', async () => {
    expect(checkFailure, 'the upstream update check must succeed').toBeNull()
    await withApp(TOOL_HOME, async (app) => {
      const cli = await app.invoke<CliStatus>('local:checkCli')
      expect(cli.installed).toBe(true)
      expect(cli.version, 'the CLI reports its version').not.toBeNull()
      const state = await app.invoke<DependenciesState>('dependencies:getState')
      expect(state.cli.state).toBe('up-to-date')
      expect(state.recommendations.state).toBe('up-to-date')
    })
  })

  it('has the locked model downloaded at its pinned size', async () => {
    await withApp(TOOL_HOME, async (app) => {
      const downloaded = await app.invoke<LocalModelInfo[]>('local:listDownloadedModels')
      expect(downloaded.map((model) => model.file)).toContain(LOCKED_MODEL)
    })
    expect((await stat(join(TOOL_HOME, 'models', LOCKED_MODEL))).size).toBe(LOCKED_MODEL_BYTES)
  })

  it('generates and names an image with the locked model', async () => {
    requireKeys([textKey('gemini')])
    const home = await mkdtemp(join(CACHE, 'drawthings-generate-'))
    try {
      await linkTree(join(TOOL_HOME, 'bin'), join(home, 'bin'))
      await linkTree(join(TOOL_HOME, 'models'), join(home, 'models'))
      await withApp(home, async (app) => {
        // The Draw Things column's parameters for a model with nothing saved yet:
        // its recommendation, then the Settings fallbacks.
        const settings = await app.invoke<AppConfig>('settings:get')
        const saved = await app.invoke<DrawThingsModelParams | null>('drawthings:getModelParams', LOCKED_MODEL)
        const recommendation = await app.invoke<DtRecommendationParams | null>('recommendations:resolve', LOCKED_MODEL)
        const params = toDrawThingsTaskParams(
          resolveDtParams(saved, recommendation, dtFallbacksFromSettings(settings as unknown as Record<string, unknown>)),
        )

        const task = await app.generate({ prompt: PROMPT, backend: 'drawthings', model: LOCKED_MODEL, params })
        const { metadata } = await readOutput(app, task)
        expect(task.imagePath?.endsWith('.png')).toBe(true)
        expect(metadata.model).toBe(LOCKED_MODEL)
        expect(metadata.slug, 'the text AI named the image, not the random fallback').toMatch(/apple/)
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe.runIf(process.platform !== 'darwin')('Draw Things off macOS', () => {
  it('reports the backend unsupported', async () => {
    const home = await mkdtemp(join(CACHE, 'drawthings-unsupported-'))
    try {
      await withApp(home, async (app) => {
        expect((await app.invoke<DependenciesState>('dependencies:getState')).platformSupported).toBe(false)
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
