import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type { Elaborator, ElaboratorKind } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'
import { log, serializeError } from './logger'
import { writeJsonAtomic } from './utils/atomic-write'

function getElaboratorsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'elaborators.json')
}

function shippedElaborators(): Elaborator[] {
  // Each template is a short list of CONCRETE, renderable specifics — the light
  // source, the lens, the palette, the framing — and nothing else. No role
  // preamble, no "preserve the content", no quality adjectives, no negations:
  // those either belong to the app (they are stated once in the expansion
  // template, where a user edit cannot weaken them) or do not survive the trip
  // to an image at all.
  //
  // That shape was measured, not assumed. The previous templates were 33-51
  // words of guidance like "believable materials, ordinary optical depth,
  // professional clarity". A model reading them echoed those adjectives into the
  // prompt verbatim — so a classifier could tell the styles apart perfectly while
  // the described SCENE stayed the same, which is why swapping them changed so
  // little on screen. Rated for how differently the resulting images would
  // actually look (0-10), the old style templates scored 5.9 and these score 8.1;
  // between the three photographic styles, where the difference matters most and
  // the old prose was weakest, 3.9-4.6 became 7.0-8.0. Composition improved
  // 3.3 -> 8.0.
  //
  // Keep that shape when editing: if two sibling templates could be satisfied by
  // one sentence, they are still too abstract to change an image.
  return [
    {
      id: 'composition-world-around-subject',
      kind: 'composition',
      name: 'World around subject',
      description: 'Adds a readable surrounding world instead of isolating the subject.',
      template: 'wide establishing shot, subject small in frame, deep focus, environment fills most of the frame',
    },
    {
      id: 'composition-story-moment',
      kind: 'composition',
      name: 'Story moment',
      description: 'Freezes one readable action or situation with contextual detail.',
      template: 'medium shot at eye level, subject caught mid-gesture, slight motion blur, off-centre placement',
    },
    {
      id: 'composition-layered-depth',
      kind: 'composition',
      name: 'Layered depth',
      description: 'Uses foreground, subject plane, and background to add richness.',
      template: 'distinct foreground object framing the shot, mid-ground subject, receding background, strong depth cues',
    },
    {
      id: 'composition-scale-distance',
      kind: 'composition',
      name: 'Scale and distance',
      description: 'Shows the subject with enough distance to reveal size and environment.',
      template: 'long lens from far off, subject dwarfed by surroundings, compressed perspective, high horizon',
    },
    {
      id: 'composition-detail-study',
      kind: 'composition',
      name: 'Detail study',
      description: 'Moves close enough to emphasize texture, features, and small differences.',
      template: 'extreme close-up, subject fills the frame, shallow focus, cropped tight on hands and object',
    },
    {
      id: 'composition-motion-path',
      kind: 'composition',
      name: 'Motion path',
      description: 'Uses direction, gesture, and implied movement.',
      template: 'subject moving across frame, trailing motion blur, leading space ahead, low shutter feel',
    },
    {
      id: 'composition-unusual-viewpoint',
      kind: 'composition',
      name: 'Unusual viewpoint',
      description: 'Changes viewpoint for a stronger visual read.',
      template: 'extreme low angle looking up, converging verticals, foreshortened subject, sky or ceiling dominant',
    },
    {
      id: 'composition-arranged-layout',
      kind: 'composition',
      name: 'Arranged layout',
      description: 'Organizes multiple elements clearly, like flat lay or display.',
      template: 'flat overhead view, objects placed on a grid, even spacing, no perspective, uniform lighting',
    },
    {
      id: 'composition-centered-poster',
      kind: 'composition',
      name: 'Centered poster',
      description: 'Strong central read for posters, covers, icons, and key art.',
      template: 'symmetrical centred subject, full-body in frame, generous headroom, plain backdrop, front-on angle',
    },
    {
      id: 'composition-plain-reference',
      kind: 'composition',
      name: 'Plain reference',
      description: 'Least transformative: clear subject presentation with minimal scene change.',
      template: 'neutral eye-level three-quarter view, subject centred and fully visible, even flat lighting, empty background',
    },
    {
      id: 'style-natural-photo',
      kind: 'style',
      name: 'Natural photo',
      description: 'Realistic camera look with natural color and believable surfaces.',
      template: 'available light only, mild film grain, 35mm everyday lens, unstyled surfaces, muted contrast',
    },
    {
      id: 'style-studio-photo',
      kind: 'style',
      name: 'Studio photo',
      description: 'Controlled lighting, polished surfaces, and commercial clarity.',
      template: 'single softbox key with fill card, seamless paper backdrop, f/8 edge-to-edge sharpness, controlled falloff, no ambient spill',
    },
    {
      id: 'style-documentary-realism',
      kind: 'style',
      name: 'Documentary realism',
      description: 'Candid, available-light, lived-in photographic realism.',
      template: 'handheld reportage frame, harsh mixed lighting, visible sensor noise, unposed subject, cluttered real background',
    },
    {
      id: 'style-cinematic-color',
      kind: 'style',
      name: 'Cinematic color',
      description: 'Film-like lighting, color grade, and atmospheric depth.',
      template: 'anamorphic lens flare, teal-and-amber grade, crushed shadows, shallow depth of field, atmospheric haze, wide 2.39:1 framing',
    },
    {
      id: 'style-high-end-cgi',
      kind: 'style',
      name: 'High-end CGI',
      description: 'Detailed 3D realism with precise materials and lighting.',
      template: 'ray-traced reflections, physically based materials, subsurface scattering on skin, studio HDRI lighting, flawless surfaces',
    },
    {
      id: 'style-stylized-3d',
      kind: 'style',
      name: 'Stylized 3D',
      description: 'Appealing 3D forms, simplified surfaces, and expressive color.',
      template: 'matte clay shading, simplified rounded forms, soft global illumination, flat colour background, toy-like scale',
    },
    {
      id: 'style-digital-illustration',
      kind: 'style',
      name: 'Digital illustration',
      description: 'Clean modern illustration with controlled edges and color.',
      template: 'clean digital brushwork, layered flat colour with soft gradients, crisp edges, painted highlights, no photographic texture',
    },
    {
      id: 'style-anime-illustration',
      kind: 'style',
      name: 'Anime illustration',
      description: 'Broad anime-inspired rendering without named franchises.',
      template: 'cel shading with hard shadow terminators, large expressive eyes, screentone accents, saturated key colours, thin ink outline',
    },
    {
      id: 'style-graphic-novel',
      kind: 'style',
      name: 'Graphic novel',
      description: 'Ink, shadow, panels-influenced contrast, and narrative drawing.',
      template: 'heavy black ink shadow, cross-hatched shading, limited spot colour, bold panel-style framing, dramatic rim light',
    },
    {
      id: 'style-vector-graphic',
      kind: 'style',
      name: 'Vector graphic',
      description: 'Flat shapes, crisp edges, simple palettes, and scalable design.',
      template: 'flat vector shapes, uniform fills, no gradients or texture, geometric simplification, sharp closed outlines',
    },
    {
      id: 'style-editorial-collage',
      kind: 'style',
      name: 'Editorial collage',
      description: 'Layered cutout, paper, photo, and graphic texture.',
      template: 'torn paper edges, layered cut-out photography, halftone print texture, mismatched scales, visible glue shadows',
    },
    {
      id: 'style-hand-painted',
      kind: 'style',
      name: 'Hand-painted illustration',
      description: 'Painterly color, visible brushwork, and crafted surfaces.',
      template: 'visible brush strokes, canvas tooth showing through, warm palette knife texture, soft blended edges',
    },
    {
      id: 'style-oil-acrylic',
      kind: 'style',
      name: 'Oil / acrylic paint',
      description: 'Opaque paint, layered pigment, and tactile brush texture.',
      template: 'thick impasto ridges, glossy wet-look highlights, blended earth tones, visible canvas weave, painterly edges',
    },
    {
      id: 'style-watercolor-gouache',
      kind: 'style',
      name: 'Watercolor / gouache',
      description: 'Soft washes, paper grain, matte color, and gentle edges.',
      template: 'bleeding pigment edges, blooming water marks, visible paper grain, translucent washes, white paper left bare',
    },
    {
      id: 'style-ink-line',
      kind: 'style',
      name: 'Ink line art',
      description: 'Line weight, hatching, monochrome or sparse color.',
      template: 'pure black line on white, uniform pen weight, cross-hatch shading only, no greys, no fill',
    },
    {
      id: 'style-retro-print',
      kind: 'style',
      name: 'Retro print',
      description: 'Screenprint, risograph, poster grain, and limited palettes.',
      template: 'misregistered CMYK dots, faded ink, aged paper stain, limited period palette, halftone visible at edges',
    },
    {
      id: 'style-pixel-art',
      kind: 'style',
      name: 'Pixel art',
      description: 'Low-resolution grid, tileable shapes, and deliberate palette limits.',
      template: 'low resolution pixel grid, limited 16-colour palette, hard aliased edges, dithered gradients, isometric block forms',
    },
    {
      id: 'style-minimal-shape',
      kind: 'style',
      name: 'Minimal shape',
      description: 'Reduced forms, quiet color, and strong negative space.',
      template: 'two or three flat shapes, single accent colour on plain ground, wide empty margins, no detail or texture',
    },
  ]
}

function defaultElaborators(kind?: ElaboratorKind): Elaborator[] {
  const items = shippedElaborators()
  return kind ? items.filter((item) => item.kind === kind) : items
}

function isElaborator(value: unknown): value is Elaborator {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Elaborator>
  if (typeof v.id !== 'string' || !v.id) return false
  // A stored file from before the content lane was removed will carry
  // kind: 'content' rows; they fail this check and are dropped on read, which is
  // the intended outcome — the lane no longer exists and nothing consumes them.
  if (!(v.kind === 'composition' || v.kind === 'style')) return false
  if (typeof v.name !== 'string') return false
  if (typeof v.template !== 'string') return false
  if (v.description != null && typeof v.description !== 'string') return false
  return true
}

// yyyymmdd-hhmmss-fff-utc stamp for the quarantine filename (mirrors api-keys-store's helper).
function utcStampForFilename(): string {
  const d = new Date()
  const p = (n: number, len = 2): string => String(n).padStart(len, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` +
    `-${p(d.getUTCMilliseconds(), 3)}-utc`
  )
}

export type ElaboratorRecoveryNotice =
  | { kind: 'recovered'; path: string }
  | { kind: 'quarantine-failed'; path: string; error: string }
  | { kind: 'reseed-failed'; path: string; error: string }

const recoveryNotices: ElaboratorRecoveryNotice[] = []

export function drainElaboratorRecoveryNotices(): ElaboratorRecoveryNotice[] {
  return recoveryNotices.splice(0)
}

// Preserve user-authored templates before reseeding. A failed rename propagates.
function quarantineCorruptFile(file: string, reason: string, err?: unknown): string {
  const dir = path.dirname(file)
  const stem = path.basename(file, path.extname(file))
  const movedTo = path.join(dir, `${stem}-${utcStampForFilename()}.invalid`)
  try {
    fs.renameSync(file, movedTo)
    log('warn', `Quarantined ${reason} elaborators file; reseeding defaults`, {
      from: file,
      to: movedTo,
      ...(err ? { error: serializeError(err) } : {}),
    })
    return movedTo
  } catch (renameErr) {
    log('error', 'Failed to quarantine corrupt elaborators file; leaving it in place', {
      path: file,
      error: serializeError(renameErr),
    })
    recoveryNotices.push({
      kind: 'quarantine-failed',
      path: file,
      error: String(serializeError(renameErr).message ?? renameErr),
    })
    throw renameErr
  }
}

// Recreate a valid live file after the corrupt one has moved aside.
function reseedAfterQuarantine(quarantinedPath: string): Elaborator[] {
  const seeded = defaultElaborators()
  try {
    writeFile(seeded)
    recoveryNotices.push({ kind: 'recovered', path: quarantinedPath })
    return seeded
  } catch (err) {
    const error = String(serializeError(err).message ?? err)
    log('error', 'Failed to reseed elaborators after quarantine', {
      quarantinedPath,
      error: serializeError(err),
    })
    recoveryNotices.push({ kind: 'reseed-failed', path: quarantinedPath, error })
    throw err
  }
}

// Reads the persisted elaborators, or null when the file is genuinely absent
// (the first-run case, before materializeElaborators has run, or after a user
// deletes the file). A present-but-corrupt file is not "absent": it is
// quarantined aside and defaults are recreated on disk in place — this function
// resolves that recovery itself and returns the reseeded items, so a null return
// means only "no file", never "unreadable file".
function readFile(): Elaborator[] | null {
  const file = getElaboratorsFilePath()
  // A missing file is the expected pre-materialization / deleted-file case — probe
  // silently and let the caller fall back to in-memory defaults without writing.
  // A file that EXISTS but is unparseable or malformed is unexpected (corrupt or
  // hand-edited); quarantine the bad bytes aside and recreate valid defaults.
  if (!fs.existsSync(file)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    const quarantinedPath = quarantineCorruptFile(file, 'unreadable', err)
    return reseedAfterQuarantine(quarantinedPath)
  }
  if (!Array.isArray(parsed) || !parsed.every(isElaborator)) {
    const quarantinedPath = quarantineCorruptFile(file, 'malformed')
    return reseedAfterQuarantine(quarantinedPath)
  }
  return parsed
}

function writeFile(items: Elaborator[]): void {
  // elaborators.json is a persisted store under the storage root; write it
  // atomically (temp + rename) so a crash mid-write can't leave a truncated
  // file that the next load would reject as malformed. Mirrors config.json.
  // recorded: elaborators.json is durable, user-authored managed text — the
  // prompt-elaboration registry the user builds up (data-backup conventions).
  writeJsonAtomic(getElaboratorsFilePath(), items, true)
}

// Write elaborators.json from the shipped defaults on first run, only when the
// file is absent — the storage-path conventions' "materialize built-in
// defaultable files on first run" rule, the same shape config-store.loadConfig
// uses for config.json. Absence is the single trigger: a present file (even a
// corrupt one) is left exactly as the user left it and never inspected here, so
// the create-if-absent path can only ever fill a gap, never overwrite. A
// corrupt file is resolved on the load path instead (readFile quarantines it
// aside then reseeds), which is the convention's other allowed branch.
//
// Called from app.whenReady at the populated-but-not-yet-used startup point,
// alongside the config seed, so a launch-then-quit leaves a real, editable
// elaborators.json on disk — inspectable and captured by the first-run backup —
// rather than a phantom the app carried in memory until the renderer first
// asked for the list. The defaults come from one in-code source of truth
// (shippedElaborators, via defaultElaborators) serialized through the app's own
// save path (writeFile → writeJsonAtomic), never a hand-built JSON literal.
export function materializeElaborators(): void {
  const file = getElaboratorsFilePath()
  if (fs.existsSync(file)) return
  writeFile(defaultElaborators())
}

export function listElaborators(): Elaborator[] {
  // A pure read of the now-present file. elaborators.json is materialized at
  // startup (materializeElaborators, called from app.whenReady before any
  // consumer reads the store), so on every production path the file already
  // exists and readFile returns its contents. If the file is genuinely absent —
  // a test or tool driving the store without the startup seed, or a user
  // deleting it at runtime — we return the in-memory defaults but do NOT write
  // here: materialization is the single first-run writer, and every mutating
  // caller (create/update/delete/reset) persists through its own writeFile, so
  // this read stays free of a side-effecting first-write.
  return readFile() ?? defaultElaborators()
}

export function createElaborator(input: {
  kind: ElaboratorKind
  name: string
  description?: string
  template: string
}): Elaborator {
  const items = listElaborators()
  // The renderer commit path (ElaboratorsModal.saveDraft) already cleans these
  // via textCleanup; here we only guard the no-content edge cases.
  const created: Elaborator = {
    id: `elab-${nanoid(10)}`,
    kind: input.kind,
    name: input.name || 'Untitled',
    description: input.description || undefined,
    template: input.template,
  }
  const firstIndexOfKind = items.findIndex((item) => item.kind === input.kind)
  if (firstIndexOfKind < 0) {
    items.push(created)
  } else {
    items.splice(firstIndexOfKind, 0, created)
  }
  writeFile(items)
  return created
}

export function updateElaborator(
  id: string,
  patch: { name?: string; description?: string; template?: string }
): Elaborator | null {
  const items = listElaborators()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return null
  const current = items[index]
  // Patch values arrive already cleaned from the renderer commit path; guard
  // only the no-content edge cases (empty name falls back to the current one).
  const next: Elaborator = {
    ...current,
    name: patch.name !== undefined ? patch.name || current.name : current.name,
    description: patch.description !== undefined ? (patch.description || undefined) : current.description,
    template: patch.template !== undefined ? patch.template : current.template,
  }
  items[index] = next
  writeFile(items)
  return next
}

export function deleteElaborator(id: string): boolean {
  const items = listElaborators()
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return false
  writeFile(next)
  return true
}

export function resetElaborators(kind?: ElaboratorKind): Elaborator[] {
  const items = kind
    ? [
        ...listElaborators().filter((item) => item.kind !== kind),
        ...defaultElaborators(kind),
      ]
    : defaultElaborators()
  writeFile(items)
  return items
}

export function getElaborator(id: string): Elaborator | null {
  return listElaborators().find((item) => item.id === id) ?? null
}
