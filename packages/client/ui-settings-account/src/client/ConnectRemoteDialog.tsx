/** Remote Harness connection form: one pasted URL and the shell-owned switch behind it. */
import { useState, type FormEvent } from 'react'
import { Button, IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountKey } from './locales.ts'
import type { DesktopRemoteConnectionResult, DesktopRemoteFailure } from '../types.ts'
import css from './ConnectRemoteDialog.module.css'

/** Locale key each shell failure code renders. */
const FAILURE_COPY: Record<DesktopRemoteFailure, AccountKey> = {
  'invalid-url': 'remoteInvalidUrl',
  'missing-token': 'remoteMissingToken',
  unreachable: 'remoteUnreachable',
  authentication: 'remoteAuthentication',
  'no-injections': 'remoteNoInjections',
  'version-mismatch': 'remoteVersionMismatch',
  'local-host': 'remoteLocalHost',
  'local-stop': 'remoteLocalStop',
  internal: 'remoteInternal',
}

/**
 * Ask for the URL printed by a remote `dsh --profile web` and hand it to the shell.
 * @param props.connectRemote - shell command that replaces this run's Harness.
 * @param props.close - dismiss the dialog while no request is in flight.
 * @param props.t - account dictionary lookup.
 * @returns the connect dialog.
 */
export function ConnectRemoteDialog({ connectRemote, close, t }: {
  connectRemote: (url: string) => Promise<DesktopRemoteConnectionResult>
  close: () => void
  t: (key: AccountKey) => string
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<DesktopRemoteFailure>()
  const dismiss = (): void => { if (!busy) close() }
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await connectRemote(url.trim())
      if (result.ok) {
        // The shell reloads this document once the remote Harness answers; stay busy meanwhile.
        return
      }
      setFailure(result.failure)
      setBusy(false)
    } catch {
      setFailure('internal')
      setBusy(false)
    }
  }
  return <Modal open headless title={t('remoteTitle')} onClose={dismiss} className={css.dialog as string}>
    <form className={css.form} onSubmit={(event) => { void submit(event) }}>
      <div className={css.header}>
        <h2 className={css.title}>{t('remoteTitle')}</h2>
        <button type="button" className={css.close} aria-label={t('close')} disabled={busy} onClick={dismiss}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </div>
      <p className={css.description}>{t('remoteDescription')}</p>
      <label className={css.label} htmlFor="desktop-remote-url">{t('remoteUrlLabel')}</label>
      <input id="desktop-remote-url" className={css.input} type="text" inputMode="url" autoFocus
        value={url} placeholder={t('remotePlaceholder')} disabled={busy}
        spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
        aria-invalid={failure !== undefined}
        onChange={(event) => { setUrl(event.target.value) }} />
      {failure !== undefined && <p className={css.error} role="alert">{t(FAILURE_COPY[failure])}</p>}
      {busy && <p className={css.status} role="status">{t('remoteConnecting')}</p>}
      <div className={css.actions}>
        <Button variant="outline" className={css.secondaryButton} disabled={busy} onClick={dismiss}>{t('cancel')}</Button>
        <Button variant="primary" type="submit" className={css.primaryButton} disabled={busy || url.trim() === ''}>
          {busy ? t('remoteConnecting') : t('remoteConnect')}
        </Button>
      </div>
    </form>
  </Modal>
}
