// The recommended-parameters file (configs.json) — one of the two managed Draw
// Things dependencies. It is versionless, so it has no honest metadata-only
// update check: launch and the set-wide Check operation never fetch its bytes.
// Install/Refresh is an explicit acquisition that validates and atomically
// publishes configs.json. The generation path reads it via
// resolveRecommendedParams; everything else is dependency management.

import fs from 'fs'
import path from 'path'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { resolveModelsDir, ensureModelsDir } from './local-cli'
import {
  fetchBytes,
  RECOMMENDATIONS_LIMITS,
  withWholeOperationTimeout,
} from './dependencies/download'
import {
  RecommendedParams,
  RecommendationStatus
} from '../shared/types'
import {
  RecommendationSpec,
  findRecommendedSettings,
  parseRecommendationBytes,
  recommendedParamsFromMatch
} from './recommendation-match'

const RECOMMENDATIONS_URL = 'https://models.drawthings.ai/configs.json'
const RECOMMENDATIONS_FILE = 'configs.json'
const RECOMMENDATIONS_PENDING_FILE = 'configs-pending.json'

// configs.json lives in the effective models dir, alongside Draw Things' own
// custom.json — its natural home, and shared with the GUI app's models when the
// user points models_dir there.
export function getRecommendationsPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_FILE)
}

export function getRecommendationsStatus(): RecommendationStatus {
  const filePath = getRecommendationsPath()
  if (!fs.existsSync(filePath)) {
    return { exists: false, valid: false, entryCount: 0, updatedAt: null }
  }

  const stat = fs.statSync(filePath)
  const parsed = parseRecommendationFile(filePath)
  return {
    exists: true,
    valid: parsed.error === null,
    entryCount: parsed.specs.length,
    updatedAt: stat.mtime.toISOString()
  }
}

/** Explicitly install or refresh configs.json. The whole transaction is bounded,
 * cancellable through durable staging, and never runs from launch or Check. */
export function downloadLatestRecommendations(signal?: AbortSignal): Promise<RecommendationStatus> {
  return withWholeOperationTimeout(
    signal,
    3 * 60 * 1000,
    'Recommendations acquisition',
    async (boundedSignal) => {
      const data = await fetchBytes(RECOMMENDATIONS_URL, RECOMMENDATIONS_LIMITS, boundedSignal)
      validateRecommendationBytes(data)
      boundedSignal.throwIfAborted()

      ensureModelsDir()
      const filePath = getRecommendationsPath()
      // not recorded: configs.json is a re-fetchable managed dependency downloaded verbatim from
      // models.drawthings.ai, living in the effective models dir alongside Draw Things' own model data
      // (not under ~/.imagequeue/) — re-acquirable content the app reads, not durable user-authored text
      // (data-backup conventions: re-fetchable dependencies are not recorded).
      await writeFileAtomicAsync(filePath, data, false, boundedSignal)
      clearObsoletePendingUpdate()
      return getRecommendationsStatus()
    }
  )
}

export function resolveRecommendedParams(model: string): RecommendedParams | null {
  const parsed = parseRecommendationFile(getRecommendationsPath())
  if (parsed.error !== null || parsed.specs.length === 0) return null
  const match = findRecommendedSettings(model, parsed.specs)
  if (!match) return null
  return recommendedParamsFromMatch(match)
}

function clearObsoletePendingUpdate(): void {
  try {
    // A pre-release build used this name for silently staged update bytes. It is
    // inert now and is removed only as part of the user's next explicit Refresh.
    fs.rmSync(path.join(resolveModelsDir(), RECOMMENDATIONS_PENDING_FILE), { force: true })
  } catch {
    /* obsolete staging is re-fetchable and never loaded */
  }
}

function validateRecommendationBytes(data: Buffer): void {
  if (parseRecommendationBytes(data).length === 0) {
    throw new Error('Recommendation file is not valid configs.json')
  }
}

function parseRecommendationFile(filePath: string): { specs: RecommendationSpec[]; error: string | null } {
  try {
    const specs = parseRecommendationBytes(fs.readFileSync(filePath))
    return { specs, error: specs.length === 0 ? 'No recommendation entries found' : null }
  } catch (err) {
    return { specs: [], error: (err as Error).message }
  }
}
