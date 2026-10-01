export class TextProviderFailure extends Error {
  constructor(readonly providerMessage: string) {
    super(providerMessage)
    this.name = 'TextProviderFailure'
  }
}
