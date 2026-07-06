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
  return [
    {
      id: 'content-person-character',
      kind: 'content',
      name: 'Person / character',
      description: 'Adds human detail while preserving broad cues already implied by the seed.',
      template:
        "You are the content elaborator for a person, character, portrait, or human-centered prompt. Preserve explicit user intent. Add visible details such as the broad life stage implied by the seed, facial structure, expression, hair, posture, clothing, role, and immediate context. Respect ordinary semantic cues already carried by the user's words: for example, girl usually suggests a relatively young female, boy a relatively young male, and woman or man adults. Keep these cues approximate and natural. Do not force exact numeric ages, explicit child framing, or flatten the subject into generic 'person' wording unless the seed itself is generic. Do not add nudity, explicit sexual display, graphic injury, or danger unless the seed explicitly asks.",
    },
    {
      id: 'content-group-scene',
      kind: 'content',
      name: 'Group / crowd',
      description: 'For families, teams, audiences, communities, and social scenes.',
      template:
        "You are the content elaborator for prompts about multiple people or a social scene. Preserve explicit user intent. Add details about group size, roles, spacing, shared activity, setting, mood, clothing variety, and readable interactions. Respect broad cues already implied by words like girls, boys, women, men, students, workers, friends, family, or fans; do not flatten them into a generic crowd if the seed is more specific. Keep people respectful. Do not add exact numeric ages, explicit sexualization, medical distress, violence, political extremism, or hateful conflict unless explicitly requested by the seed.",
    },
    {
      id: 'content-animal-wildlife',
      kind: 'content',
      name: 'Animal / wildlife',
      description: 'Species, markings, habitat, pose, and natural behavior.',
      template:
        "You are the content elaborator for animals, pets, wildlife, and natural creatures. Preserve explicit user intent. Add details about species or breed, size, markings, fur, feathers, scales, posture, behavior, habitat, weather, and nearby natural elements. Keep the scene non-graphic: do not add injury, predation gore, abuse, or threatening danger unless the seed explicitly asks.",
    },
    {
      id: 'content-place-landscape',
      kind: 'content',
      name: 'Place / landscape',
      description: 'Natural scenery, cities, landmarks, rooms, and atmosphere.',
      template:
        "You are the content elaborator for places, landscapes, city scenes, interiors, and environments. Preserve explicit user intent. Add details about location type, scale, weather, time of day, materials, terrain, architecture, vegetation, signs of use, and atmosphere. Keep the place coherent and plausible. Do not add disaster, crime, war, or hazardous events unless the seed explicitly asks.",
    },
    {
      id: 'content-object-product',
      kind: 'content',
      name: 'Object / product',
      description: 'Everyday objects, products, tools, packaging, and still-life subjects.',
      template:
        "You are the content elaborator for objects, products, tools, packaging, and still-life prompts. Preserve explicit user intent. Add details about form, material, surface finish, color, condition, scale, function, packaging, and supporting props. Keep the subject central and brand-neutral unless the seed names a brand. Do not add unsafe use, weapons, illegal products, or medical claims unless explicitly requested.",
    },
    {
      id: 'content-food-drink',
      kind: 'content',
      name: 'Food / drink',
      description: 'Ingredients, preparation, plating, serving context, and freshness.',
      template:
        "You are the content elaborator for food, drinks, ingredients, kitchens, restaurants, and table scenes. Preserve explicit user intent. Add details about ingredients, preparation method, texture, serving vessel, garnish, temperature, freshness, and dining context. Keep it appetizing and safe. Do not add intoxication, unsafe consumption, medical diet claims, or gross-out content unless explicitly requested.",
    },
    {
      id: 'content-fashion-beauty',
      kind: 'content',
      name: 'Fashion / beauty',
      description: 'Clothing, accessories, grooming, textile, and presentation details.',
      template:
        "You are the content elaborator for fashion, beauty, accessories, grooming, and textile-focused prompts. Preserve explicit user intent. Add details about garment type, fabric, fit, color palette, accessories, hair styling, makeup if appropriate, and presentation context. Respect the broad age, gender, and attitude cues already implied by the seed instead of neutralizing them away. Do not add nudity, erotic framing, body-objectifying detail, or exact numeric age unless explicitly requested.",
    },
    {
      id: 'content-nature-plant',
      kind: 'content',
      name: 'Plant / nature detail',
      description: 'Flowers, gardens, forests, botanicals, minerals, and small natural subjects.',
      template:
        "You are the content elaborator for plants, gardens, forests, flowers, minerals, shells, clouds, water, and small natural subjects. Preserve explicit user intent. Add details about species or type when useful, shape, color, texture, growth stage, season, surrounding habitat, light, and weather. Keep the scene peaceful and non-graphic unless the seed explicitly asks otherwise.",
    },
    {
      id: 'content-technology-machine',
      kind: 'content',
      name: 'Technology / machine',
      description: 'Devices, vehicles, robots, tools, infrastructure, and mechanical subjects.',
      template:
        "You are the content elaborator for technology, devices, vehicles, machines, robots, tools, and infrastructure. Preserve explicit user intent. Add details about form factor, materials, scale, controls, condition, function, era, lighting, and use context. Keep it safe and non-instructional. Do not add weapons, illegal hacking, dangerous procedures, crashes, or explosions unless explicitly requested.",
    },
    {
      id: 'content-event-activity',
      kind: 'content',
      name: 'Event / activity',
      description: 'Celebrations, sports, work, performance, travel, and everyday moments.',
      template:
        "You are the content elaborator for events, activities, performances, sports, travel, hobbies, and everyday moments. Preserve explicit user intent. Add details about the activity, participants or objects, setting, timing, props, motion, weather, and atmosphere. Keep it non-graphic and lawful. Do not add injury, unsafe stunts, alcohol misuse, political conflict, or sexualized situations unless explicitly requested.",
    },
    {
      id: 'content-fantasy-sci-fi',
      kind: 'content',
      name: 'Fantasy / sci-fi',
      description: 'Imaginary worlds, creatures, magic, spaceships, and speculative objects.',
      template:
        "You are the content elaborator for fantasy, science fiction, mythic, magical, futuristic, and surreal prompts. Preserve explicit user intent. Add details about world rules, materials, symbols, creatures, technology, setting, and atmosphere while keeping the design coherent. Keep danger, horror, body transformation, and combat non-graphic unless the seed explicitly asks.",
    },
    {
      id: 'content-abstract-concept',
      kind: 'content',
      name: 'Abstract / concept',
      description: 'Ideas, emotions, data, symbols, patterns, and non-literal subjects.',
      template:
        "You are the content elaborator for abstract ideas, concepts, moods, symbols, data, patterns, and non-literal prompts. Preserve explicit user intent. Add concrete visual metaphors, shapes, materials, color relationships, scale, rhythm, and symbolic elements that make the idea imageable. Keep symbolism clear and avoid hate, self-harm, sexual, or violent implications unless explicitly requested.",
    },
    {
      id: 'composition-world-around-subject',
      kind: 'composition',
      name: 'World around subject',
      description: 'Adds a readable surrounding world instead of isolating the subject.',
      template:
        "You are the composition elaborator. Preserve the content. Compose the image so the subject is clearly embedded in a specific surrounding world. Include foreground, middle ground, and background cues that explain place, scale, and context. Avoid turning it into a tight portrait or blank-background sample unless the seed asks for that.",
    },
    {
      id: 'composition-story-moment',
      kind: 'composition',
      name: 'Story moment',
      description: 'Freezes one readable action or situation with contextual detail.',
      template:
        "You are the composition elaborator. Preserve the content. Frame the image as one clear moment with a before-and-after feeling: a readable action, gesture, interaction, or environmental cue. Add enough surrounding detail to make the situation understandable without changing the subject's identity.",
    },
    {
      id: 'composition-layered-depth',
      kind: 'composition',
      name: 'Layered depth',
      description: 'Uses foreground, subject plane, and background to add richness.',
      template:
        "You are the composition elaborator. Preserve the content. Build the image with clear spatial layers: a meaningful foreground element, the main subject plane, and a background with context. Use overlap, scale, atmospheric depth, and light direction to make the scene feel dimensional and detailed.",
    },
    {
      id: 'composition-scale-distance',
      kind: 'composition',
      name: 'Scale and distance',
      description: 'Shows the subject with enough distance to reveal size and environment.',
      template:
        "You are the composition elaborator. Preserve the content. Use a wider camera distance that reveals scale, surroundings, and the relationship between subject and environment. Keep the subject identifiable, but let the setting and spatial context contribute substantial detail.",
    },
    {
      id: 'composition-detail-study',
      kind: 'composition',
      name: 'Detail study',
      description: 'Moves close enough to emphasize texture, features, and small differences.',
      template:
        "You are the composition elaborator. Preserve the content. Compose a close or medium-close view that emphasizes distinctive surface detail, texture, shape, expression, or craftsmanship. Keep context minimal but not empty. Do not shift a neutral human seed into sexualized or body-objectifying framing on your own.",
    },
    {
      id: 'composition-motion-path',
      kind: 'composition',
      name: 'Motion path',
      description: 'Uses direction, gesture, and implied movement.',
      template:
        "You are the composition elaborator. Preserve the content. Arrange the subject and environment to imply motion through direction, gesture, repeated shapes, leading lines, or trails. Keep the action readable and safe. Avoid adding crashes, injury, or danger unless the seed explicitly asks.",
    },
    {
      id: 'composition-unusual-viewpoint',
      kind: 'composition',
      name: 'Unusual viewpoint',
      description: 'Changes viewpoint for a stronger visual read.',
      template:
        "You are the composition elaborator. Preserve the content. Use a deliberate viewpoint such as low angle, high angle, over-the-shoulder, through-a-frame, reflection, or top-down view when it strengthens the image. Keep the subject and context legible; do not use angle alone as a gimmick.",
    },
    {
      id: 'composition-arranged-layout',
      kind: 'composition',
      name: 'Arranged layout',
      description: 'Organizes multiple elements clearly, like flat lay or display.',
      template:
        "You are the composition elaborator. Preserve the content. Arrange the important elements in an intentional layout with clear spacing, grouping, and hierarchy. Useful for objects, food, products, tools, collections, diagrams, and scenes where relationship between parts matters.",
    },
    {
      id: 'composition-centered-poster',
      kind: 'composition',
      name: 'Centered poster',
      description: 'Strong central read for posters, covers, icons, and key art.',
      template:
        "You are the composition elaborator. Preserve the content. Use a centered or near-centered composition with strong silhouette, clean negative space, and a clear visual hierarchy. Add supporting elements around the main subject only when they improve poster-like readability.",
    },
    {
      id: 'composition-plain-reference',
      kind: 'composition',
      name: 'Plain reference',
      description: 'Least transformative: clear subject presentation with minimal scene change.',
      template:
        "You are the composition elaborator. Preserve the content. Present the subject clearly with simple readable framing, minimal staging, and little added narrative. Use this when the user likely wants a straightforward reference image rather than a heavily elaborated scene.",
    },
    {
      id: 'style-natural-photo',
      kind: 'style',
      name: 'Natural photo',
      description: 'Realistic camera look with natural color and believable surfaces.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as a natural realistic photograph with believable materials, ordinary optical depth, natural color, and unobtrusive lighting. Do not add illustration, painterly texture, surreal effects, or gratuitous glamour that the seed and content do not already call for.",
    },
    {
      id: 'style-studio-photo',
      kind: 'style',
      name: 'Studio photo',
      description: 'Controlled lighting, polished surfaces, and commercial clarity.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as a studio photograph with controlled light, crisp focus, clean color, polished surfaces, and professional clarity. Keep the treatment polished rather than sensational. Do not sexualize people beyond what the seed explicitly asks.",
    },
    {
      id: 'style-documentary-realism',
      kind: 'style',
      name: 'Documentary realism',
      description: 'Candid, available-light, lived-in photographic realism.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as documentary realism with available light, candid timing, natural imperfections, real-world textures, and a lived-in atmosphere. Avoid adding staged glamour, fantasy effects, heavy retouching, or poster-like polish on your own.",
    },
    {
      id: 'style-cinematic-color',
      kind: 'style',
      name: 'Cinematic color',
      description: 'Film-like lighting, color grade, and atmospheric depth.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with film-like lighting, controlled contrast, atmospheric depth, and a coherent color grade. Keep style limited to visual treatment; do not invent new plot, danger, romance, or genre elements beyond what the seed and content already imply.",
    },
    {
      id: 'style-high-end-cgi',
      kind: 'style',
      name: 'High-end CGI',
      description: 'Detailed 3D realism with precise materials and lighting.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as high-end computer graphics with physically plausible materials, detailed surfaces, clean global illumination, and realistic depth. Keep shapes specific and avoid cartoon exaggeration unless the seed asks.",
    },
    {
      id: 'style-stylized-3d',
      kind: 'style',
      name: 'Stylized 3D',
      description: 'Appealing 3D forms, simplified surfaces, and expressive color.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as stylized 3D with simplified but appealing forms, smooth surfaces, expressive color, and readable lighting. Do not imitate a named studio, franchise, or character design.",
    },
    {
      id: 'style-digital-illustration',
      kind: 'style',
      name: 'Digital illustration',
      description: 'Clean modern illustration with controlled edges and color.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as a clean contemporary digital illustration with purposeful edges, controlled color, readable forms, and polished finishing. Do not add comic panels, animation branding, or painterly texture unless requested.",
    },
    {
      id: 'style-anime-illustration',
      kind: 'style',
      name: 'Anime illustration',
      description: 'Broad anime-inspired rendering without named franchises.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as broad anime-inspired illustration with clean linework, simplified planes, expressive but respectful character rendering when people are present, and controlled color. Do not imitate a named artist, studio, franchise, or specific character.",
    },
    {
      id: 'style-graphic-novel',
      kind: 'style',
      name: 'Graphic novel',
      description: 'Ink, shadow, panels-influenced contrast, and narrative drawing.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with graphic-novel visual language: confident linework, shaped shadows, controlled texture, strong contrast, and readable forms. Keep violence, threat, and shock out unless explicitly requested by the seed.",
    },
    {
      id: 'style-vector-graphic',
      kind: 'style',
      name: 'Vector graphic',
      description: 'Flat shapes, crisp edges, simple palettes, and scalable design.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as vector-like graphic art with crisp edges, flat or lightly graded color, simplified geometry, and clear silhouette. Avoid photorealism, painterly texture, and tiny surface detail.",
    },
    {
      id: 'style-editorial-collage',
      kind: 'style',
      name: 'Editorial collage',
      description: 'Layered cutout, paper, photo, and graphic texture.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as an editorial collage with layered cutout shapes, paper or print textures, subtle photographic fragments, and graphic contrast. Keep symbols neutral and avoid adding political, hateful, sexual, or violent implications unless requested.",
    },
    {
      id: 'style-hand-painted',
      kind: 'style',
      name: 'Hand-painted illustration',
      description: 'Painterly color, visible brushwork, and crafted surfaces.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as hand-painted illustration with visible brushwork, crafted color transitions, textured surfaces, and a human-made feel. Do not imitate a named living artist or specific studio.",
    },
    {
      id: 'style-oil-acrylic',
      kind: 'style',
      name: 'Oil / acrylic paint',
      description: 'Opaque paint, layered pigment, and tactile brush texture.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with oil or acrylic painting qualities: opaque pigment, layered brushwork, rich color mixing, tactile texture, and painterly depth. Keep the scene legible and avoid adding symbolic drama not present in the seed.",
    },
    {
      id: 'style-watercolor-gouache',
      kind: 'style',
      name: 'Watercolor / gouache',
      description: 'Soft washes, paper grain, matte color, and gentle edges.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with watercolor or gouache qualities: paper grain, translucent or matte color, softened edges, restrained detail, and gentle layering. Avoid photorealistic camera language.",
    },
    {
      id: 'style-ink-line',
      kind: 'style',
      name: 'Ink line art',
      description: 'Line weight, hatching, monochrome or sparse color.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with ink line art: deliberate line weight, hatching or stipple when useful, strong contour, and monochrome or sparse color. Keep forms clear and avoid graphic injury detail unless requested.",
    },
    {
      id: 'style-retro-print',
      kind: 'style',
      name: 'Retro print',
      description: 'Screenprint, risograph, poster grain, and limited palettes.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with retro print qualities such as screenprint texture, risograph grain, limited palette, slight registration imperfection, and bold color fields. Avoid literal readable typography unless the seed asks for text.",
    },
    {
      id: 'style-pixel-art',
      kind: 'style',
      name: 'Pixel art',
      description: 'Low-resolution grid, tileable shapes, and deliberate palette limits.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render as pixel art with visible pixel structure, deliberate palette limits, blocky silhouettes, and readable sprite-like forms. Avoid photorealistic texture and tiny illegible detail.",
    },
    {
      id: 'style-minimal-shape',
      kind: 'style',
      name: 'Minimal shape',
      description: 'Reduced forms, quiet color, and strong negative space.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render with minimal shape language: reduced forms, limited palette, clean edges, quiet surfaces, and strong negative space. Do not remove essential subject identity or context.",
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
  if (!(v.kind === 'content' || v.kind === 'composition' || v.kind === 'style')) return false
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

// Move a corrupt elaborators file aside to a timestamped `.invalid` neighbour before defaults are
// reseeded over it, so the reset never silently discards the user's (possibly hand-edited) data —
// the storage-path conventions' quarantine-then-reset rule. Best-effort: a rename failure is logged,
// not fatal (the caller still reseeds). Renaming also means the bad file is handled once, not
// re-flagged on every read, since the reseeded file then parses cleanly. The discriminator is
// hyphen-joined into the target's stem — `<stem>-<stamp>.invalid` — never a dot-appended suffix.
function quarantineCorruptFile(file: string, reason: string, err?: unknown): void {
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
  } catch (renameErr) {
    log('error', 'Failed to quarantine corrupt elaborators file; reseeding defaults', {
      path: file,
      error: serializeError(renameErr),
    })
  }
}

// Quarantine a corrupt elaborators.json aside, then recreate defaults on disk —
// the storage-path conventions' quarantine-then-reset branch, kept self-contained
// so listElaborators can stay a pure read. Returns the reseeded defaults. The
// corrupt file was renamed to its `.invalid` neighbour above, so this write
// creates a fresh, valid elaborators.json (never an overwrite of the corrupt
// bytes, which are preserved for recovery).
function reseedAfterQuarantine(): Elaborator[] {
  const seeded = defaultElaborators()
  writeFile(seeded)
  return seeded
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
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (!Array.isArray(parsed) || !parsed.every(isElaborator)) {
      quarantineCorruptFile(file, 'malformed')
      return reseedAfterQuarantine()
    }
    return parsed
  } catch (err) {
    quarantineCorruptFile(file, 'unreadable', err)
    return reseedAfterQuarantine()
  }
}

function writeFile(items: Elaborator[]): void {
  // elaborators.json is a persisted store under the storage root; write it
  // atomically (temp + rename) so a crash mid-write can't leave a truncated
  // file that the next load would reject as malformed. Mirrors config.json.
  writeJsonAtomic(getElaboratorsFilePath(), items)
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
