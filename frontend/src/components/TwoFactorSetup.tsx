import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { CopyBox } from './CopyBox'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'

interface TotpSetup {
  secret: string
  otpauth_uri: string
  /** data: URL for an <img>. */
  qr_svg: string
}

function onlyDigits(v: string): string {
  return v.replace(/\D/g, '').slice(0, 6)
}

/**
 * Inline 2FA enrolment: QR code, manual key, 6-digit code, Activate.
 * Used by the setup wizard (mandatory step) and by the Security settings card.
 */
export function TwoFactorSetup({
  autoStart = false,
  onEnabled,
  onCancel,
}: {
  /** Call /auth/2fa/setup as soon as the component mounts (the wizard does; settings waits for a click). */
  autoStart?: boolean
  onEnabled?: () => void
  /** When given, a Cancel button closes the QR panel. */
  onCancel?: () => void
}) {
  const t = useT()
  const { refresh } = useAuth()
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [code, setCode] = useState('')
  const [activateBusy, setActivateBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(autoStart)

  const startSetup = useCallback(async () => {
    setError(null)
    setSetupBusy(true)
    try {
      const { data } = await api.post<TotpSetup>('/auth/2fa/setup')
      setSetup(data)
      setCode('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSetupBusy(false)
    }
  }, [])

  useEffect(() => {
    if (started && !setup && !setupBusy) void startSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started])

  const activate = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setActivateBusy(true)
    try {
      await api.post('/auth/2fa/enable', { code: code.trim() })
      setSetup(null)
      setCode('')
      await refresh().catch(() => undefined)
      onEnabled?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setActivateBusy(false)
    }
  }

  if (!started) {
    return (
      <div>
        <button type="button" className="btn-primary" onClick={() => setStarted(true)} disabled={setupBusy}>
          {setupBusy && <Spinner />} {t('security.setup2fa')}
        </button>
        <ErrorNote message={error} className="mt-3" />
      </div>
    )
  }

  if (!setup) {
    return (
      <div>
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
          <Spinner /> {t('twofa.preparing')}
        </div>
        {error && (
          <div className="mt-2 space-y-2">
            <ErrorNote message={error} />
            <button type="button" className="btn-secondary" onClick={startSetup} disabled={setupBusy}>
              {t('twofa.tryAgain')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={activate} className="rounded-card border border-line bg-lavender p-4 space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <img
          src={setup.qr_svg}
          alt={t('security.qrAlt')}
          width={180}
          height={180}
          className="h-[180px] w-[180px] shrink-0 rounded-card border border-line bg-white p-2 self-center sm:self-start"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="mono-label">{t('twofa.step1')}</div>
          <p className="text-xs text-neutral-600">{t('security.scanHint')}</p>
          <div className="label mt-2">{t('twofa.manualKey')}</div>
          <CopyBox value={setup.secret} />
        </div>
      </div>
      <div>
        <div className="mono-label mb-1">{t('twofa.step2')}</div>
        <label className="label" htmlFor="twofa-code">{t('security.codeFromApp')}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="twofa-code"
            className="input tnum tracking-widest sm:w-44 text-lg"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(onlyDigits(e.target.value))}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={activateBusy || code.length !== 6}>
              {activateBusy && <Spinner />} {t('twofa.enable')}
            </button>
            {onCancel && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSetup(null)
                  setStarted(false)
                  setError(null)
                  onCancel()
                }}
              >
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>
      </div>
      <ErrorNote message={error} />
    </form>
  )
}
