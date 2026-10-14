// What Settings reads to label its System choices; a test environment pins it.
export const settingsEnvironment = {
  getLanguageEnvironment: async () => ({
    language: 'en', locale: 'en', timeZone: 'UTC', systemLanguage: 'en', systemTimeZone: 'Asia/Tokyo',
  }),
  getSystemAppearance: async () => 'dark' as const,
}
