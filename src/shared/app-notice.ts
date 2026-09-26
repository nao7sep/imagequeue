import type { Message } from './i18n/translate'

// An app-wide notice main raises for the renderer. Its words are messages, so
// the notice reads in whatever language is current when it is shown.
export interface AppNotice {
  title: Message
  message: Message
}
