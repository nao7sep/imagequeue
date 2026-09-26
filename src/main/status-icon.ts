import { app, Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions } from 'electron'
import path from 'path'
import type { QueueControlState } from '../shared/types'
import { log, serializeError } from './logger'
import { subscribeQueueControlState } from './queue/publisher'
import { message, type Message, type Translator } from '../shared/i18n/translate'
import { mainTranslator, onLanguageChanged } from './i18n'

export type StatusIconAppearance = 'light' | 'dark'

export function statusIconAssetName(
  platform: NodeJS.Platform,
  appearance: StatusIconAppearance,
): string | null {
  if (platform === 'darwin') return 'ImageQueueStatusTemplate.png'
  if (platform !== 'win32') return null
  return appearance === 'dark' ? 'ImageQueueStatusDark.ico' : 'ImageQueueStatusLight.ico'
}

export function buildStatusIconTooltip(state: QueueControlState, translator: Translator): string {
  const parts: Message[] = []
  if (state.paused) parts.push(message('statusIcon.paused'))
  if (state.generating > 0) parts.push(message('statusIcon.generating', { count: state.generating }))
  if (state.queued > 0) parts.push(message('statusIcon.queued', { count: state.queued }))
  if (state.interrupted > 0) parts.push(message('statusIcon.interrupted', { count: state.interrupted }))
  // Parts stack through one join entry, so the language chooses the separator.
  const summary = parts.length === 0
    ? message('statusIcon.idle')
    : parts.reduceRight((rest, first) => message('statusIcon.join', { first, rest }))
  return translator.t('statusIcon.tooltip', { app: 'ImageQueue', state: summary })
}

interface StatusIconControllerOptions {
  platform?: NodeJS.Platform
  restoreMainWindow: () => Promise<void> | void
  requestQuit: () => void
  openOutputFolder: () => Promise<void> | void
  setQueuePaused: (paused: boolean) => Promise<void> | void
}

const EMPTY_CONTROL_STATE: QueueControlState = {
  paused: false,
  generating: 0,
  queued: 0,
  interrupted: 0,
}

/** Owns the process's one native status icon and derived menu presentation. */
export class StatusIconController {
  private readonly platform: NodeJS.Platform
  private tray: Tray | null = null
  private unsubscribeQueue: (() => void) | null = null
  private unsubscribeLanguage: (() => void) | null = null
  private controlState = EMPTY_CONTROL_STATE
  private reconcileGeneration = 0

  constructor(private readonly options: StatusIconControllerOptions) {
    this.platform = options.platform ?? process.platform
  }

  isAvailable(): boolean {
    return Boolean(this.tray && !this.tray.isDestroyed())
  }

  async reconcile(enabled: boolean): Promise<boolean> {
    const generation = ++this.reconcileGeneration
    if (enabled) {
      if (this.isAvailable()) return true
      return this.createIcon()
    }

    if (this.isAvailable()) {
      // Keep the recovery path alive until the ordinary window is reachable.
      try {
        await this.options.restoreMainWindow()
      } catch (err) {
        log('error', 'Status icon could not be disabled because the main window was not restored', {
          error: serializeError(err),
        })
        return true
      }
      if (generation !== this.reconcileGeneration) return this.isAvailable()
    }
    this.destroyIcon()
    return false
  }

  dispose(): void {
    this.reconcileGeneration++
    this.destroyIcon()
  }

  private createIcon(): boolean {
    const assetName = statusIconAssetName(this.platform, this.currentAppearance())
    if (!assetName) return false

    let partialTray: Tray | null = null
    try {
      const image = nativeImage.createFromPath(path.join(this.resourceDirectory(), assetName))
      if (image.isEmpty()) throw new Error(`Status icon asset is empty or missing: ${assetName}`)
      if (this.platform === 'darwin') image.setTemplateImage(true)

      partialTray = new Tray(image)
      this.tray = partialTray
      this.rebuildPresentation()
      if (this.platform === 'win32') {
        this.tray.on('click', () => { this.runAction('restore main window', this.options.restoreMainWindow) })
        nativeTheme.on('updated', this.handleThemeUpdated)
      }
      this.unsubscribeQueue = subscribeQueueControlState((state) => {
        this.controlState = state
        this.rebuildPresentation()
      })
      this.unsubscribeLanguage = onLanguageChanged(() => this.rebuildPresentation())
      log('info', 'Status icon enabled', { platform: this.platform, asset: assetName })
      return true
    } catch (err) {
      if (partialTray && !partialTray.isDestroyed()) partialTray.destroy()
      this.tray = null
      this.unsubscribeQueue?.()
      this.unsubscribeQueue = null
      this.unsubscribeLanguage?.()
      this.unsubscribeLanguage = null
      nativeTheme.off('updated', this.handleThemeUpdated)
      log('error', 'Status icon could not be initialized; using ordinary window lifecycle', {
        platform: this.platform,
        asset: assetName,
        error: serializeError(err),
      })
      return false
    }
  }

  private destroyIcon(): void {
    this.unsubscribeQueue?.()
    this.unsubscribeQueue = null
    this.unsubscribeLanguage?.()
    this.unsubscribeLanguage = null
    nativeTheme.off('updated', this.handleThemeUpdated)
    const tray = this.tray
    this.tray = null
    if (tray && !tray.isDestroyed()) tray.destroy()
  }

  private rebuildPresentation(): void {
    const tray = this.tray
    if (!tray || tray.isDestroyed()) return
    const state = this.controlState
    const translator = mainTranslator()
    const { t } = translator
    const template: MenuItemConstructorOptions[] = [
      {
        label: t('statusIcon.open', { app: 'ImageQueue' }),
        click: () => { this.runAction('restore main window', this.options.restoreMainWindow) },
      },
      {
        label: t('statusIcon.openOutputFolder'),
        click: () => { this.runAction('open output folder', this.options.openOutputFolder) },
      },
      { type: 'separator' },
      {
        label: state.paused ? t('statusIcon.resume') : t('statusIcon.pause'),
        click: () => {
          this.runAction(state.paused ? 'resume queue' : 'pause queue', () =>
            this.options.setQueuePaused(!state.paused))
        },
      },
      { type: 'separator' },
      {
        label: t(this.platform === 'darwin' ? 'statusIcon.quit' : 'statusIcon.exit', { app: 'ImageQueue' }),
        click: this.options.requestQuit,
      },
    ]
    tray.setToolTip(buildStatusIconTooltip(state, translator))
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  private readonly handleThemeUpdated = (): void => {
    const tray = this.tray
    if (!tray || tray.isDestroyed() || this.platform !== 'win32') return
    const assetName = statusIconAssetName(this.platform, this.currentAppearance())
    if (!assetName) return
    try {
      const image = nativeImage.createFromPath(path.join(this.resourceDirectory(), assetName))
      if (image.isEmpty()) throw new Error(`Status icon asset is empty or missing: ${assetName}`)
      tray.setImage(image)
    } catch (err) {
      // Keep the last working image. Losing contrast is preferable to losing the
      // only recovery control while the main window is hidden.
      log('warn', 'Status icon theme image could not be updated', {
        asset: assetName,
        error: serializeError(err),
      })
    }
  }

  private currentAppearance(): StatusIconAppearance {
    // Forced-colors themes reuse the same exact T2 geometry: white on a dark
    // system surface, black on a light one. A separate outlined asset changed
    // the cards' apparent spacing and was less faithful without adding contrast.
    return nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? 'dark' : 'light'
  }

  private resourceDirectory(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'status-icons')
      : path.join(app.getAppPath(), 'build', 'status-icons')
  }

  private runAction(label: string, action: () => Promise<void> | void): void {
    try {
      void Promise.resolve(action()).catch((err) => {
        log('error', `Status icon action failed: ${label}`, { error: serializeError(err) })
      })
    } catch (err) {
      log('error', `Status icon action failed: ${label}`, { error: serializeError(err) })
    }
  }
}
