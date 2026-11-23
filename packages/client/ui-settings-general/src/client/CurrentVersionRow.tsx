/** Installed release version in General Settings for Web and Desktop. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

/**
 * Format the release label this row reports: the version every complete build
 * embeds, plus the commit when the build opts into revision display
 * (`DSH_CLIENT_REVISION_BADGE=true`), which keeps release builds to the version.
 * @returns `version[-commit]`, or undefined when the build records no version.
 */
function buildRevision(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  if (process.env.DSH_CLIENT_REVISION_BADGE !== 'true') return version
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version + (commit === undefined ? '' : `-${commit}`)
}

/**
 * Render the version embedded by the client build; partial builds without metadata omit the row.
 * @param props - runtime share and localized copy.
 * @returns the current release label, or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const revision = buildRevision()
  if (revision === undefined) return null
  return <div className={css.row}>{t('general.currentVersion', { version: revision })}</div>
}
