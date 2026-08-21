import type { BackendId, LocalModelInfo } from '../../../shared/types'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../shared/types'
import type { TargetScope } from '../../../shared/session-draft'

export interface AdvancedTargets {
  proprietary: BackendId[]
  dt: string[]
}

/** Pure target resolution for the Advanced Prompting scope controls. */
export function resolveAdvancedTargets(options: {
  scope: TargetScope
  selectedProprietary: Partial<Record<BackendId, boolean>>
  selectedDtFiles: readonly string[]
  downloadedDtModels: readonly LocalModelInfo[]
  proprietaryEnabled: Readonly<Record<string, boolean>>
}): AdvancedTargets {
  const {
    scope, selectedProprietary, selectedDtFiles,
    downloadedDtModels, proprietaryEnabled,
  } = options
  const proprietary: BackendId[] = []
  let dt: string[] = []

  if (scope === 'selected') {
    for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      if (selectedProprietary[id] && proprietaryEnabled[id]) proprietary.push(id)
    }
    const selected = new Set(selectedDtFiles)
    dt = downloadedDtModels.map((model) => model.file).filter((file) => selected.has(file))
  } else if (scope === 'all-proprietary') {
    for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      if (proprietaryEnabled[id]) proprietary.push(id)
    }
  } else if (scope === 'all-drawthings') {
    dt = downloadedDtModels.map((model) => model.file)
  } else {
    for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      if (proprietaryEnabled[id]) proprietary.push(id)
    }
    dt = downloadedDtModels.map((model) => model.file)
  }

  return { proprietary, dt }
}
