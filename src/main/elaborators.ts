import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type { Elaborator, ElaboratorKind } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'

function getElaboratorsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'elaborators.json')
}

function shippedElaborators(): Elaborator[] {
  return [
    {
      id: 'content-distinct-scene',
      kind: 'content',
      name: 'Distinct scene',
      description: 'General-purpose gap filler that strengthens subject identity and scene specificity.',
      template:
        "You are the content elaborator. Preserve all explicit user intent. Fill missing high-salience content details so the image becomes distinct rather than generic. For human subjects, prioritize human-salience cues: age impression, ancestry or regional impression when appropriate, face shape, eye shape, nose, lips, complexion, hair, expression, posture, and silhouette before clothing. For non-human subjects, prioritize the most identity-defining features for that subject class: vehicles by body type, era, condition, modifications, and silhouette; animals by species, breed, markings, age, pose, and behavior; places by structure, era, materials, and surroundings; objects by form, material, condition, and notable use context; events and effects by geometry, density, scale, and physical behavior. Add plausible specifics only where the seed is underspecified. Do not add random absurd twists or unrelated genre drift.",
    },
    {
      id: 'content-human-priority',
      kind: 'content',
      name: 'Human priority',
      description: 'Identity-first elaboration for people and characters, with human-salience details leading.',
      template:
        "You are the content elaborator for human or humanoid subjects. Preserve explicit user intent and strengthen identity before scene dressing. If the seed is sparse, spend most of the creativity budget on identity cues that humans notice first: ancestry or regional impression when appropriate, age impression, facial structure, eyes, nose, lips, complexion, hair shape and texture, expression, gaze, posture, and silhouette. Clothing, props, action, and setting should support that person rather than dominate them. If the seed already specifies identity traits, keep them and only fill missing identity axes. Avoid stereotype collapse, random cosplay, or decorative clutter.",
    },
    {
      id: 'content-animal-creature',
      kind: 'content',
      name: 'Animal / creature',
      description: 'Species-first distinctness for animals, monsters, and creatures.',
      template:
        "You are the content elaborator for animals and creatures. Preserve explicit user intent. Make the subject distinct through species or breed cues, markings, age, build, anatomy, pose, behavior, and habitat before adding style. Choose one coherent behavior or moment rather than many. For fantasy creatures, keep the design internally consistent and readable instead of piling on random features.",
    },
    {
      id: 'content-vehicle-machine',
      kind: 'content',
      name: 'Vehicle / machine',
      description: 'Silhouette, era, condition, and mechanical identity come first.',
      template:
        "You are the content elaborator for vehicles, machines, and industrial subjects. Preserve explicit user intent. Strengthen distinctness through silhouette, class, era, scale, condition, materials, modifications, markings, and use context. If motion matters, pick one clear mechanical action or operating state. Avoid replacing the user's chosen machine type with something else or adding unrelated sci-fi fantasy unless the seed asks for it.",
    },
    {
      id: 'content-place-architecture',
      kind: 'content',
      name: 'Place / architecture',
      description: 'Makes environments more distinct through structure, era, materials, and surroundings.',
      template:
        "You are the content elaborator for places, architecture, and environment-heavy prompts. Preserve explicit user intent. Strengthen distinctness through structure type, era, materials, scale, weathering, landscape context, and human traces where appropriate. Prefer one coherent place with a readable function and atmosphere instead of mixing many unrelated location ideas together.",
    },
    {
      id: 'content-object-product',
      kind: 'content',
      name: 'Object / product',
      description: 'Clarifies form, material, use, and distinguishing product details.',
      template:
        "You are the content elaborator for objects, products, food, and still-life subjects. Preserve explicit user intent. Make the subject distinct through form factor, materials, surface finish, craftsmanship, scale, condition, era, and use context. If there is a supporting environment, keep it subordinate to the object. Avoid turning a simple product into a busy narrative scene unless the seed clearly invites that.",
    },
    {
      id: 'content-event-effect',
      kind: 'content',
      name: 'Event / effect',
      description: 'For fireworks, explosions, weather, energy, and other transient phenomena.',
      template:
        "You are the content elaborator for events, effects, and transient phenomena such as fireworks, lightning, explosions, smoke, mist, waves, and magical energy. Preserve explicit user intent. Make the image distinct through shape, phase, density, rhythm, scale, color behavior, reflections, debris or smoke behavior, and surrounding context. Do not inject unrelated character or object detail unless the seed already contains it.",
    },
    {
      id: 'composition-balanced-editorial',
      kind: 'composition',
      name: 'Balanced editorial',
      description: 'Readable, natural framing with one clear focal subject.',
      template:
        "You are the composition elaborator. Preserve the content. Use balanced, readable framing with one clear focal subject, sensible depth, and a camera distance that shows the important details without clutter. Prefer strong visual hierarchy and clean negative space over gimmicks.",
    },
    {
      id: 'composition-close-focus',
      kind: 'composition',
      name: 'Close focus',
      description: 'Close-up or tight framing that emphasizes distinctive detail.',
      template:
        "You are the composition elaborator. Preserve the content. Frame the image close enough that distinctive details dominate the read. Use tight portrait, close-up, or detail-oriented framing as appropriate, with clear subject isolation and minimal distracting background information.",
    },
    {
      id: 'composition-environmental-medium',
      kind: 'composition',
      name: 'Environmental medium',
      description: 'Subject plus enough environment to understand the scene.',
      template:
        "You are the composition elaborator. Preserve the content. Use an environmental medium shot that keeps the subject readable while showing enough surrounding context to explain where they are and what is happening. Balance subject clarity with scene storytelling.",
    },
    {
      id: 'composition-wide-establishing',
      kind: 'composition',
      name: 'Wide establishing',
      description: 'Wider framing that prioritizes place, scale, and atmosphere.',
      template:
        "You are the composition elaborator. Preserve the content. Use a wide establishing composition that emphasizes scale, location, and atmosphere while keeping the key subject still identifiable. Let foreground, middle ground, and background read clearly.",
    },
    {
      id: 'composition-dynamic-angle',
      kind: 'composition',
      name: 'Dynamic angle',
      description: 'Stronger angle and movement cues for energy and impact.',
      template:
        "You are the composition elaborator. Preserve the content. Introduce dynamic framing through viewpoint, angle, motion cues, or perspective exaggeration when it helps energy. Keep the scene readable and coherent; do not make it chaotic just to look dramatic.",
    },
    {
      id: 'composition-graphic-centered',
      kind: 'composition',
      name: 'Graphic centered',
      description: 'Centered, poster-like arrangement with bold shape readability.',
      template:
        "You are the composition elaborator. Preserve the content. Use a centered or strongly graphic arrangement with clean shape readability, symmetrical or near-symmetrical balance when helpful, and simple spatial layering suitable for posters, icons, or bold key art.",
    },
    {
      id: 'style-photorealistic',
      kind: 'style',
      name: 'Photorealistic',
      description: 'Clean, modern professional photograph.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the scene as a clean, modern, photorealistic image with natural texture, believable materials, and realistic light. Avoid painterly or illustrated language.",
    },
    {
      id: 'style-cinematic',
      kind: 'style',
      name: 'Cinematic',
      description: 'Single frame from a film, composed and color-graded.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the scene like a single frame from a film, with cinematic lighting, disciplined color grading, atmospheric depth, and a sense of story contained in one image.",
    },
    {
      id: 'style-documentary-photo',
      kind: 'style',
      name: 'Documentary photo',
      description: 'Candid, imperfect, photojournalistic realism.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image with documentary or photojournalistic realism: candid timing, available light, slight imperfection, and a lived-in non-commercial feel.",
    },
    {
      id: 'style-modern-anime',
      kind: 'style',
      name: 'Modern anime',
      description: 'Clean contemporary anime illustration.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as a clean contemporary anime illustration with purposeful linework, vivid but controlled color, expressive faces, and polished digital finishing.",
    },
    {
      id: 'style-studio-ghibli',
      kind: 'style',
      name: 'Studio Ghibli',
      description: 'Warm painted anime with gentle atmosphere.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image with the warmth and softness associated with Studio Ghibli-inspired painted animation: gentle expression, atmospheric background painting, and natural light with nostalgic calm.",
    },
    {
      id: 'style-disney-pixar-3d',
      kind: 'style',
      name: 'Disney / Pixar 3D',
      description: 'Appealing stylized 3D animation.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as stylized 3D animation with appealing forms, expressive surfaces, rich lighting, and polished family-film readability.",
    },
    {
      id: 'style-american-comic',
      kind: 'style',
      name: 'American comic book',
      description: 'Bold inks, halftones, and graphic action.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image like an American comic-book panel with bold inking, graphic shadow, halftone or print texture, and punchy visual storytelling.",
    },
    {
      id: 'style-manga-bw',
      kind: 'style',
      name: 'Japanese manga (B&W)',
      description: 'Black-and-white ink with screentones and dramatic contrast.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as black-and-white manga art with decisive linework, screentone logic, dramatic contrast, and expressive monochrome design.",
    },
    {
      id: 'style-oil-painting',
      kind: 'style',
      name: 'Oil painting',
      description: 'Classical painted texture and rich pigment.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as an oil painting with visible brushwork, rich pigment, and painterly depth while keeping the scene legible and specific.",
    },
    {
      id: 'style-watercolor',
      kind: 'style',
      name: 'Watercolor',
      description: 'Soft translucent washes and light paper feel.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as watercolor with translucent washes, softened edges, restrained line support, and a light paper-based feel.",
    },
    {
      id: 'style-ink-drawing',
      kind: 'style',
      name: 'Ink drawing',
      description: 'Fine line, hatching, and minimal color.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as an ink drawing with deliberate line quality, hatching or crosshatching, strong shape design, and little or no color.",
    },
    {
      id: 'style-minimalist',
      kind: 'style',
      name: 'Minimalist graphic',
      description: 'Flat, restrained, and shape-driven.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image with minimalist graphic restraint: limited palette, simplified forms, clean edges, and strong use of negative space.",
    },
    {
      id: 'style-vintage-poster',
      kind: 'style',
      name: 'Vintage poster',
      description: 'Retro print design with bold stylized shapes.',
      template:
        "You are the style elaborator. Preserve the content and composition. Render the image as a vintage poster with print-like texture, limited palette, bold stylized shapes, and retro graphic energy without literal typography.",
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

function readFile(): Elaborator[] | null {
  const file = getElaboratorsFilePath()
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (!Array.isArray(parsed)) return null
    if (!parsed.every(isElaborator)) return null
    return parsed
  } catch {
    return null
  }
}

function writeFile(items: Elaborator[]): void {
  fs.writeFileSync(getElaboratorsFilePath(), JSON.stringify(items, null, 2), 'utf-8')
}

export function listElaborators(): Elaborator[] {
  const stored = readFile()
  if (stored !== null) return stored
  const seeded = defaultElaborators()
  writeFile(seeded)
  return seeded
}

export function createElaborator(input: {
  kind: ElaboratorKind
  name: string
  description?: string
  template: string
}): Elaborator {
  const items = listElaborators()
  const created: Elaborator = {
    id: `elab-${nanoid(10)}`,
    kind: input.kind,
    name: input.name.trim() || 'Untitled',
    description: input.description?.trim() || undefined,
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
  const next: Elaborator = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
    description: patch.description !== undefined ? (patch.description.trim() || undefined) : current.description,
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
