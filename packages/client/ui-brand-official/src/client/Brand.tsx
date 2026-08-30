import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps, SidebarFooterVersionOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <FishLogo size={size} className={className} />
}

/**
 * Format the local revision text shown below the brand row when the build
 * opts into revision display (`DSH_CLIENT_REVISION_BADGE=true`).
 * @returns `version[-commit]`, or undefined when revision display is off.
 */
function revisionLabel(): string | undefined {
  if (process.env.DSH_CLIENT_REVISION_BADGE !== 'true') return undefined
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version + (commit === undefined ? '' : `-${commit}`)
}

/**
 * Render the official name wordmark without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}

/**
 * Render the opt-in local revision below the brand row, above New Session.
 * @param props - host-supplied footer presentation.
 * @returns the revision label, or null when disabled, absent, or on the rail.
 */
export function OfficialBuildRevision({ wide }: SidebarFooterVersionOwnerProps) {
  if (!wide) return null
  const revision = revisionLabel()
  if (revision === undefined) return null
  return (
    <span className={css.revisionText}>
      <span className={css.revisionIcon}>🔨</span>
      <span>{revision}</span>
    </span>
  )
}
