/** Sidebar account launcher, its shell-owned application commands, and the locally authoritative sign-out action. */
import { useEffect, useRef, useState } from 'react'
import {
  Toast, Menu, IconCloseOutlineMedium, IconDownloadOutlineMedium, IconEllipsisOutlineMedium, IconInfoOutlineMedium,
  IconPaperPlaneOutlineMedium, IconPlayOutlineMedium, IconRefreshOutlineMedium, IconSettingsOutlineMedium,
  IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { AccountAvatar } from './AccountAvatar.tsx'
import { AccountNoticeCard } from './AccountNotice.tsx'
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
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings, openOnboarding, settingsOpen,
  useAccount, useTheme, signOut, hasRunningAccountTasks, refreshAccount, bonusNoticeShown, bonusNoticeDismissed,
  contactUs, showLogin, start, cancel, application, avatarFailed, t,
}: AccountMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  // The launcher outlives the panel, so a false-to-true edge is one Settings entry:
  // re-renders, section switches and tab switches inside one open must not read again.
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const signedIn = account.view?.status === 'credential-stored'
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const profile = account.details?.profile
  const label = profile === undefined ? null : profile.status === 'ready'
    ? profile.value.name ?? profile.value.contact ?? t('signedIn') : t('signedIn')
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [signOutImpact, setSignOutImpact] = useState<boolean | 'unknown'>()
  const requestSignOut = async () => {
    setBusy(true)
    try { setSignOutImpact(await hasRunningAccountTasks()); setOpen(false) }
    catch (_error) { setSignOutImpact('unknown'); setOpen(false) }
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
    { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
      ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
    { id: 'contact', label: t('contactUs'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
    ...(signedIn ? [{ id: 'signout', label: t('signOut'), icon: <LogoutIcon />, disabled: busy }]
      : [{ id: 'signin', label: t('signIn'), icon: <IconUserOutlineMedium size={16} /> }]),
    ...application === undefined ? [] : [
      { type: 'separator' as const, id: 'quit-command' },
      { id: 'quit', label: t('quitApplication'), icon: <IconCloseOutlineMedium size={16} /> },
    ],
  ]
  return <div ref={anchor} className={css.root}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    {signedIn && !account.desktopOnboardingVisible && !account.onboarding && account.notice && <AccountNoticeCard
      key={account.notice.orderId} notice={account.notice}
      anchor={anchor} title={t('bonusNoticeTitle')} closeLabel={t('close')}
      onShown={bonusNoticeShown} onDismiss={bonusNoticeDismissed} />}
    <Menu open={open} side="top" portal autoFocus className={css.anchor} listClassName={signedIn ? undefined : css.signedOutMenu}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide} data-signed-out={!signedIn} aria-label={t('menu')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {signedIn
          ? <span className={css.avatar} data-avatar-status={account.avatar?.status}>
            <AccountAvatar avatar={account.avatar} avatarFailed={avatarFailed} />
          </span>
          : <IconEllipsisOutlineMedium size={14} />}
        {wide && <span className={css.label}>{signedIn ? label : t('more')}</span>}
      </button>}
      items={items}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        if (id === 'settings') { setOpen(false); trigger.current?.focus(); openSettings() }
        else if (id === 'contact') { setOpen(false); contactUs() }
        else if (id === 'signin') beginSignIn()
        else if (id === 'signout') void requestSignOut()
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
    {signedIn && signOutImpact !== undefined && <SignOutDialog running={signOutImpact} signOut={signOut}
      close={() => { setSignOutImpact(undefined) }} t={t} />}
  </div>
}
