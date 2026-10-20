// The pages the app's one renderer bundle can show besides the main window,
// chosen by the `surface` query; main opens windows on them and main.tsx picks
// the page by the same names.
export const RENDERER_SURFACES = ['records', 'preview-window', 'fullscreen-view', 'quit-failure', 'startup-failure'] as const
export type RendererSurface = (typeof RENDERER_SURFACES)[number]
