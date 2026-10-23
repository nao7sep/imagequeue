import { createContext, type RefObject } from 'react'

// Menus stay inside their dialog for accessibility and stacking, while their
// fixed popups sit outside its scrolling body.
export const ModalLayerContext = createContext<{
  modalId: string
  boxRef: RefObject<HTMLDivElement | null>
} | null>(null)
