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

/**
 * Partition Draw Things models into local imports vs. catalog, using custom.json
 * as the import ground truth.
 *
 * draw-things-cli reports `source: official` for every entry in custom.json, so the
 * source column alone cannot separate a locally-imported model from a real official
 * one. custom.json membership decides instead:
 *   - in custom.json AND present on disk (downloaded) → a local import.
 *   - in custom.json but the file was deleted (not downloaded) → silently dropped:
 *     it is never shown as a (broken) official download. Such a model can still be
 *     re-installed through the Import flow, which imports by file path independent
 *     of this partition.
 *   - not in custom.json → a real catalog model (trust the CLI's source column).
 *
 * `importedFiles` is null when custom.json is absent or unreadable — there is then
 * no import ground truth, so every model is treated as catalog.
 */
export function partitionDrawThingsModels(
  models: LocalModelInfo[],
  importedFiles: ReadonlySet<string> | null
): { localImports: LocalModelInfo[]; catalog: LocalModelInfo[] } {
  const isImported = (model: LocalModelInfo): boolean =>
    importedFiles !== null && importedFiles.has(model.file)
  return {
    localImports: models.filter((model) => isImported(model) && model.downloaded),
    catalog: models.filter((model) => !isImported(model)),
  }
}
