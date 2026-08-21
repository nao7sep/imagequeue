import {
  CONCEPT_REUSE_WINDOW_DRAWS,
  addConcepts,
  addProbes,
  drawConcept,
  listFacetsWithStats,
  listProbeDisplays,
  markProbeExpanded,
  unexpandedProbes,
  type DrawnConcept,
  type FacetRow,
} from './concept-store'
import {
  PROBE_AVOID_LIST_MAX,
  expandProbes,
  generateProbes,
  planProbeBatchSize,
  planProbeGenerationSize,
  type AskJson,
} from './planner'
import { log } from '../logger'

const MAX_REFILL_ROUNDS = 3

export interface RunExcludes {
  concepts: Set<number>
  probes: Set<number>
}

export interface ConceptRunStats {
  draws: number
  mints: number
  probesGenerated: number
  conceptsAdded: number
  staleFallbacks: number
}

export function newConceptRunStats(): ConceptRunStats {
  return { draws: 0, mints: 0, probesGenerated: 0, conceptsAdded: 0, staleFallbacks: 0 }
}

export function ledgerTotals(): { facets: number; domains: number; concepts: number; unused: number } {
  const all = listFacetsWithStats()
  return {
    facets: all.length,
    domains: all.reduce((count, facet) => count + facet.probeCount, 0),
    concepts: all.reduce((count, facet) => count + facet.conceptCount, 0),
    unused: all.reduce((count, facet) => count + facet.unusedCount, 0),
  }
}

export function facetInventory(facets: readonly FacetRow[]): Record<string, unknown>[] {
  const byId = new Map(listFacetsWithStats().map((facet) => [facet.id, facet]))
  return facets.map((facet) => {
    const stats = byId.get(facet.id)
    return {
      facet: facet.display,
      concepts: stats?.conceptCount ?? 0,
      unused: stats?.unusedCount ?? 0,
      domains: stats?.probeCount ?? 0,
    }
  })
}

/** Draw a wave for one facet, minting bounded new stock when needed. */
export async function obtainConceptsForFacet(options: {
  facet: FacetRow
  ask: AskJson
  sessionId: string
  preferNew: boolean
  excludes: RunExcludes
  count: number
  requestId: string
  stats: ConceptRunStats
}): Promise<DrawnConcept[]> {
  const { facet, ask, sessionId, preferNew, excludes, count, requestId, stats } = options
  const out: DrawnConcept[] = []
  const mintsBefore = stats.mints
  for (let index = 0; index < count; index++) {
    const concept = await obtainConcept({
      facet,
      ask,
      sessionId,
      preferNew,
      excludes,
      valuesStillNeeded: count - index,
      requestId,
      stats,
    })
    excludes.concepts.add(concept.id)
    excludes.probes.add(concept.probeId)
    stats.draws++
    out.push(concept)
  }
  log('debug', 'Concepts drawn for facet', {
    requestId,
    facet: facet.display,
    drawn: count,
    mintedRounds: stats.mints - mintsBefore,
    values: out.map((concept) => concept.display),
  })
  return out
}

async function obtainConcept(options: {
  facet: FacetRow
  ask: AskJson
  sessionId: string
  preferNew: boolean
  excludes: RunExcludes
  valuesStillNeeded: number
  requestId: string
  stats: ConceptRunStats
}): Promise<DrawnConcept> {
  const {
    facet, ask, sessionId, preferNew, excludes,
    valuesStillNeeded, requestId, stats,
  } = options
  const baseOpts = {
    sessionId,
    windowDraws: CONCEPT_REUSE_WINDOW_DRAWS,
    excludeConceptIds: [...excludes.concepts],
    excludeProbeIds: [...excludes.probes],
  }
  const first = drawConcept(facet.id, { ...baseOpts, allowStale: !preferNew })
  if (first) return first

  for (let round = 0; round < MAX_REFILL_ROUNDS; round++) {
    const mintStart = Date.now()
    let generated = 0
    let probes = unexpandedProbes(facet.id, planProbeBatchSize(valuesStillNeeded))
    if (probes.length === 0) {
      const requested = planProbeGenerationSize(valuesStillNeeded)
      const texts = await generateProbes(
        ask,
        facet.display,
        listProbeDisplays(facet.id, PROBE_AVOID_LIST_MAX),
        requested,
      )
      generated = addProbes(facet.id, texts)
      stats.probesGenerated += generated
      probes = unexpandedProbes(facet.id, planProbeBatchSize(valuesStillNeeded))
      if (probes.length === 0) {
        log('warn', 'Domain generation added nothing new', {
          requestId,
          facet: facet.display,
          round: round + 1,
          requested,
          returned: texts.length,
          alreadyKnown: texts.length - generated,
        })
        continue
      }
    }

    const clusters = await expandProbes(ask, facet.display, probes)
    const totalReturned = clusters.reduce((count, cluster) => count + cluster.concepts.length, 0)
    if (totalReturned === 0) {
      log('warn', 'Cluster expansion returned no concepts', {
        requestId,
        facet: facet.display,
        round: round + 1,
        domainsAsked: probes.length,
      })
      continue
    }

    let added = 0
    for (const { probeId, concepts } of clusters) {
      added += addConcepts(facet.id, probeId, concepts)
      markProbeExpanded(probeId)
    }
    stats.conceptsAdded += added
    stats.mints++
    log('info', 'Minted concepts', {
      requestId,
      facet: facet.display,
      round: round + 1,
      neededValues: valuesStillNeeded,
      domainsGenerated: generated,
      domainsExpanded: probes.length,
      conceptsAdded: added,
      durationMs: Date.now() - mintStart,
    })
    const fresh = drawConcept(facet.id, { ...baseOpts, allowStale: false })
    if (fresh) return fresh
  }

  const stale = drawConcept(facet.id, { ...baseOpts, allowStale: true })
  if (stale) {
    stats.staleFallbacks++
    log('warn', 'Fell back to a previously used concept', {
      requestId,
      facet: facet.display,
      afterRounds: MAX_REFILL_ROUNDS,
      concept: stale.display,
    })
    return stale
  }

  throw new Error(
    `Could not obtain an unused "${facet.display}" concept after ${MAX_REFILL_ROUNDS} refill rounds.`
  )
}
