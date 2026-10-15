// What Settings reads to label its System choices, and where it reports
// unsaved edits; a test environment pins it.
export const settingsEnvironment = {
  getLanguageEnvironment: async () => ({
    language: 'en', locale: 'en', timeZone: 'UTC', systemLanguage: 'ja', systemTimeZone: 'Asia/Tokyo',
  }),
  getSystemAppearance: async () => 'dark' as const,
  reportUnsavedDraft: async () => undefined,
}
