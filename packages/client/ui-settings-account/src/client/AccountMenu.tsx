/** Sidebar account launcher, its shell-owned application commands, and the locally authoritative sign-out action. */
import { useState } from 'react'
import {
  Menu, IconCloseOutlineMedium, IconDownloadOutlineMedium, IconInfoOutlineMedium, IconPaperPlaneOutlineMedium,
  IconPlayOutlineMedium, IconRefreshOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { AccountAvatar } from './AccountAvatar.tsx'
import css from './AccountMenu.module.css'

/**
 * Format the local build revision shown under the About row. Release builds
 * leave `DSH_CLIENT_REVISION_BADGE` unset, so their About row carries the label
 * alone; a local build that opts in reports the revision it was built from.
 * @returns `version[-commit]`, or undefined when revision display is off or the build carries no version.
 */
function buildRevision(): string | undefined {
  if (process.env.DSH_CLIENT_REVISION_BADGE !== 'true') return undefined
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version + (commit === undefined ? '' : `-${commit}`)
}

/** Account launcher composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>

/** The signed-in label stays empty while the profile loads.
 * @param props - sidebar geometry, settings navigation and account operations.
 * @returns account menu launcher.
 */
export function AccountMenu({
  wide, openSettings, openOnboarding, useAccount, useTheme, signOut, contactUs, showLogin, start, cancel, application, t,
}: AccountMenuProps) {
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const signedIn = account.view?.status === 'credential-stored'
  const profile = account.details?.profile
  const label = profile === undefined ? null : profile.status === 'ready'
    ? profile.value.name ?? profile.value.contact ?? t('signedIn') : t('signedIn')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logoutFailed, setLogoutFailed] = useState(false)
  const logout = async () => {
    setBusy(true)
    setLogoutFailed(false)
    try { await signOut(); setOpen(false) }
    catch { setLogoutFailed(true) }
    finally { setBusy(false) }
  }
  // The plugin's start publishes `loginFailed` before it rejects, so the dialog owns the report.
  const beginSignIn = (): void => { setOpen(false); void start().catch(() => undefined) }
  // The shell's application menu, without the macOS-only window visibility
  // commands. Each registered row carries the command its id resolves to.
  const applicationItems: MenuEntry[] = []
  const applicationCommands = new Map<string, () => Promise<void>>()
  if (application !== undefined) {
    // The build revision rides the About row as a second line, so the row is
    // the one place a user can read which build they are running.
    const revision = buildRevision()
    applicationItems.push(
      {
        id: 'about',
        label: revision === undefined ? t('about') : (
          <span className={css.aboutItem}>
            <span>{t('about')}</span>
            <span className={css.aboutRevision}>{revision}</span>
          </span>
        ),
        icon: <IconInfoOutlineMedium size={16} />,
      },
      { id: 'updates', label: t('checkUpdates'), icon: <IconDownloadOutlineMedium size={16} /> },
    )
    applicationCommands.set('about', application.about)
    applicationCommands.set('updates', application.openUpdates)
    if (application.development) {
      applicationItems.push(
        { id: 'reload', label: t('reloadPage'), icon: <IconRefreshOutlineMedium size={16} /> },
        { id: 'restart', label: t('restartApplication'), icon: <IconPlayOutlineMedium size={16} /> },
      )
      applicationCommands.set('reload', application.reload)
      applicationCommands.set('restart', application.restart)
    }
    applicationCommands.set('quit', application.quit)
  }
  const items: MenuEntry[] = [
    ...applicationItems,
    ...applicationItems.length === 0 ? [] : [{ type: 'separator' as const, id: 'account' }],
    { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} /> },
    { id: 'contact', label: t('contactUs'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
    ...(signedIn ? [{ id: 'signout', label: t('signOut'), icon: <LogoutIcon />, disabled: busy }]
      : [{ id: 'signin', label: t('signIn'), icon: <IconUserOutlineMedium size={16} /> }]),
    ...application === undefined ? [] : [
      { type: 'separator' as const, id: 'quit-command' },
      { id: 'quit', label: t('quitApplication'), icon: <IconCloseOutlineMedium size={16} /> },
    ],
  ]
  return <div className={css.root}>
    <Menu open={open} side="top" portal autoFocus className={css.anchor}
      anchor={<button type="button" className={css.trigger} data-collapsed={!wide} aria-label={t('menu')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className={css.avatar}><AccountAvatar url={signedIn && profile?.status === 'ready' ? profile.value.avatarUrl : null} /></span>
        {wide && <span className={css.label}>{signedIn ? label : t('signedOut')}</span>}
      </button>}
      items={items}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        if (id === 'settings') { setOpen(false); openSettings() }
        else if (id === 'contact') { setOpen(false); contactUs() }
        else if (id === 'signin') beginSignIn()
        else if (id === 'signout') void logout()
        else {
          setOpen(false)
          const command = applicationCommands.get(id)
          /* v8 ignore next -- the Menu reports only rendered rows, and every application row registers its command above. */
          if (command === undefined) return
          // The native application menu has no failure surface for these shell
          // commands either, so a rejection reports to the console.
          void command().catch((error: unknown) => { console.error(error) })
        }
      }} />
    {account.loginVisible && !account.onboarding && <SignInDialog account={account} colorScheme={colorScheme}
      start={start} cancel={cancel} t={t}
      close={() => { showLogin(false) }} useApiKey={() => { showLogin(false); openOnboarding('deepseek-official') }} />}
    {logoutFailed && <span className={css.error} role="alert">{t('failed')}</span>}
  </div>
}
