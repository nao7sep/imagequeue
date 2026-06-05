import type { PromptMode } from '../context/AdvancedPromptingContext'

// A "brainstorm" mode generates fresh prompts via the text AI (one per
// iteration, or one per task), as opposed to reusing the seed as-is or a single
// already-elaborated prompt. These are the modes whose prompts are recorded in
// the session history once their tasks are queued.
export function isBrainstormMode(mode: PromptMode): boolean {
  return mode === 'fresh-iteration' || mode === 'fresh-task'
}
