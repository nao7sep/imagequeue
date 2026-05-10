import type { LocalModelInfo } from '../../../shared/types'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function localModelName(model: LocalModelInfo): string {
  return model.name || model.file
}

export function sortLocalModels(models: LocalModelInfo[]): LocalModelInfo[] {
  return [...models].sort((a, b) =>
    collator.compare(
      `${localModelName(a)} ${a.file}`.toLowerCase(),
      `${localModelName(b)} ${b.file}`.toLowerCase()
    )
  )
}
