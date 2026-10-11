let quitting = false
export function setQuitting(value: boolean): void { quitting = value }
export function isQuitting(): boolean { return quitting }

export function assertNotQuitting(): void {
  if (quitting) throw new Error('ImageQueue is quitting')
}
