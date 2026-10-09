import { retryConfigSaves } from './config/config-store'
import { retryApiKeySaves } from './config/api-keys-store'
import { retryElaboratorSaves } from './elaborators'

/** The existing save owners retain failed intent; quit uses their same path. */
export async function retrySettingsWrites(): Promise<void> {
  const results = await Promise.allSettled([retryConfigSaves(), retryApiKeySaves(), retryElaboratorSaves()])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
