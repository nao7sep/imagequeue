// Presentation state belongs to this application launch, across renderer loads
// and session switches. It is deliberately not written to the session or settings.
let showKeptImages = false

export function getShowKeptImages(): boolean {
  return showKeptImages
}

export function toggleShowKeptImages(): boolean {
  showKeptImages = !showKeptImages
  return showKeptImages
}
