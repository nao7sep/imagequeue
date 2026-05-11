import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type { Elaborator } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'

function getElaboratorsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'elaborators.json')
}

function defaultElaborators(): Elaborator[] {
  return [
    // --- Photography & film ---
    {
      id: nanoid(10),
      name: 'Photorealistic',
      description: 'Clean, modern professional photograph.',
      template:
        "You expand the user's seed into a prompt for a clean, professional, photorealistic image. Pick concrete subject details and natural lighting framed as if shot on a modern digital camera. Avoid painterly or illustrated descriptors. Each prompt is 25-40 words of natural English.",
    },
    {
      id: nanoid(10),
      name: 'Cinematic',
      description: 'Single frame from a film, composed and color-graded.',
      template:
        "You expand the user's seed into a prompt that reads like a single frame from a film — composed framing, dramatic lighting, atmospheric color grading, a sense of story in one shot. Pick details that reinforce the on-screen mood. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Documentary photo',
      description: 'Gritty, candid, photojournalistic.',
      template:
        "You expand the user's seed into a prompt for a candid documentary or photojournalistic photo — real moments, available light, slight imperfection, no posed or commercial polish. Each prompt is 25-40 words.",
    },

    // --- Animation ---
    {
      id: nanoid(10),
      name: 'Studio Ghibli',
      description: 'Miyazaki-style painted anime with warm light.',
      template:
        "You expand the user's seed into a prompt for a scene in the visual style of Studio Ghibli — soft painted backgrounds, warm natural light, gentle character expression, a hint of nostalgia. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Modern anime',
      description: 'Clean contemporary anime illustration.',
      template:
        "You expand the user's seed into a prompt for a modern anime illustration — clean line art, vivid color, expressive faces, dynamic composition. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Disney / Pixar 3D',
      description: 'Expressive 3D animation, rounded character design.',
      template:
        "You expand the user's seed into a prompt for a Disney- or Pixar-style 3D animated frame — appealing rounded character design, expressive faces, warm cinematic lighting, depth and richness in the scene. Each prompt is 25-40 words.",
    },

    // --- Comics & manga ---
    {
      id: nanoid(10),
      name: 'American comic book',
      description: 'Bold inks, halftone, dynamic action.',
      template:
        "You expand the user's seed into a prompt for an American comic book panel — bold ink outlines, dramatic poses, halftone shading, a strong action or storytelling moment. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Japanese manga (B&W)',
      description: 'Black-and-white ink, screentones, dramatic angles.',
      template:
        "You expand the user's seed into a prompt for a black-and-white Japanese manga panel — ink linework, screentone shading, dramatic angles, expressive character work. Each prompt is 25-40 words.",
    },

    // --- Traditional media ---
    {
      id: nanoid(10),
      name: 'Oil painting',
      description: 'Classical textured brushwork.',
      template:
        "You expand the user's seed into a prompt for a classical oil painting — visible brushwork, rich pigment, considered composition, traditional palette. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Watercolor',
      description: 'Soft translucent washes, bleeding edges.',
      template:
        "You expand the user's seed into a prompt for a watercolor painting — soft translucent washes, bleeding edges, restrained linework, a sense of lightness and air. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Pencil & charcoal',
      description: 'Monochrome graphite sketch.',
      template:
        "You expand the user's seed into a prompt for a monochrome pencil-and-charcoal drawing — graphite tones, shading by hatch and smudge, expressive linework, no color. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Ink drawing',
      description: 'Fine line, crosshatching, minimal or no color.',
      template:
        "You expand the user's seed into a prompt for a fine ink drawing — clean line work, crosshatching for shadow, minimal or no color, precise detail. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: "Children's book",
      description: 'Warm, playful storybook illustration.',
      template:
        "You expand the user's seed into a prompt for a children's book illustration — warm cheerful colors, simplified shapes, friendly characters, playful storybook composition. Each prompt is 25-40 words.",
    },

    // --- Art movements ---
    {
      id: nanoid(10),
      name: 'Impressionist',
      description: 'Plein-air light, visible broken brushwork.',
      template:
        "You expand the user's seed into a prompt for an impressionist painting — visible broken brushwork, atmospheric light, soft edges, capturing a moment of changing light or weather. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Surrealist',
      description: 'Dreamlike impossibilities, precise rendering.',
      template:
        "You expand the user's seed into a prompt for a surrealist painting — dreamlike impossibility, unexpected juxtapositions, symbolic objects, calm precise rendering of the impossible. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Cubist / abstract geometric',
      description: 'Fragmented planes, Picasso-ish geometry.',
      template:
        "You expand the user's seed into a prompt for a cubist or geometric abstract image — fragmented planes, multiple viewpoints folded into one, bold simplified palette. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Pop art',
      description: 'Bold flat color, Warhol / Lichtenstein vibe.',
      template:
        "You expand the user's seed into a prompt for a pop art image — bold flat color, comic-book halftone or screenprint feel, an everyday subject treated as iconic. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Ukiyo-e',
      description: 'Japanese woodblock print, flat color planes.',
      template:
        "You expand the user's seed into a prompt for a Japanese ukiyo-e woodblock print — flat color planes, bold outline, traditional composition, period-appropriate motifs where natural. Each prompt is 25-40 words.",
    },

    // --- Design & graphic ---
    {
      id: nanoid(10),
      name: 'Minimalist',
      description: 'Flat geometric restraint, lots of negative space.',
      template:
        "You expand the user's seed into a prompt for a minimalist composition — limited palette, flat geometric forms, generous negative space, only the essential subject. Each prompt is 20-35 words.",
    },
    {
      id: nanoid(10),
      name: 'Vintage poster',
      description: 'Retro print design, two- or three-color palette.',
      template:
        "You expand the user's seed into a prompt for a vintage poster — printed-paper texture, period typography energy (without literal text), two- or three-color print palette, bold stylized shapes. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Advertising / commercial',
      description: 'Clean, polished, product-focused.',
      template:
        "You expand the user's seed into a prompt for a clean commercial advertising image — strong subject focus, controlled studio lighting, aspirational mood, polished composition. Each prompt is 25-40 words.",
    },

    // --- Mood & genre ---
    {
      id: nanoid(10),
      name: 'Horror / dark',
      description: 'Eerie, unsettling, low-key tension.',
      template:
        "You expand the user's seed into a prompt with horror or dark atmosphere — low-key lighting, unease, restrained composition that withholds rather than shows, tension over shock. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'Cyberpunk',
      description: 'Neon, rain, high-tech mixed with urban decay.',
      template:
        "You expand the user's seed into a prompt set in a cyberpunk world — neon signage, rain-slick surfaces, high-tech mixed with urban decay, dense layered environments. Each prompt is 25-40 words.",
    },
    {
      id: nanoid(10),
      name: 'High fantasy',
      description: 'Mythic, epic, painterly grandeur.',
      template:
        "You expand the user's seed into a prompt for a high-fantasy scene — mythic atmosphere, painterly grandeur, magical or otherworldly elements grounded in concrete sensory detail. Each prompt is 25-40 words.",
    },

    // --- Creative stretch ---
    {
      id: nanoid(10),
      name: 'Wildly creative',
      description: 'Unexpected interpretations, odd-but-coherent combinations.',
      template:
        "You expand the user's seed in unexpected creative directions — surprising subject choices, unusual perspectives, odd-but-coherent combinations. Stretch the interpretation rather than playing it safe. Do not pin to one fixed medium. Each prompt is 25-40 words.",
    },
  ]
}

function isElaborator(value: unknown): value is Elaborator {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Elaborator>
  if (typeof v.id !== 'string' || !v.id) return false
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
    return parsed.filter(isElaborator)
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

export function createElaborator(input: { name: string; description?: string; template: string }): Elaborator {
  const items = listElaborators()
  const created: Elaborator = {
    id: nanoid(10),
    name: input.name.trim() || 'Untitled',
    description: input.description?.trim() || undefined,
    template: input.template,
  }
  items.unshift(created)
  writeFile(items)
  return created
}

export function updateElaborator(id: string, patch: { name?: string; description?: string; template?: string }): Elaborator | null {
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

export function resetElaborators(): Elaborator[] {
  const seeded = defaultElaborators()
  writeFile(seeded)
  return seeded
}

export function getElaborator(id: string): Elaborator | null {
  return listElaborators().find((item) => item.id === id) ?? null
}
