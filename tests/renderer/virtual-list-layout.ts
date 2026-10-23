import { vi } from 'vitest'

// jsdom supplies no layout. Keep the real virtualizer and provide a measured
// viewport and variable-height rows, with a real scroll event for each move.
export function installVirtualListLayout(): () => void {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
  const row = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('[data-index]') ? 100 + (this.textContent?.length ?? 0) / 10 : 500
  })
  const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height || '500')
  })
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? this.scrollTop
    this.dispatchEvent(new Event('scroll'))
  } })
  return () => {
    height.mockRestore(); width.mockRestore(); row.mockRestore(); scrollHeight.mockRestore()
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScroll)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  }
}
