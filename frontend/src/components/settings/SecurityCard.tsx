import { useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import type { Company } from '../../types'
import { CopyBox } from '../CopyBox'
import { ErrorNote } from '../ErrorNote'
import { Spinner } from '../Spinner'
import { StatusPill } from '../StatusPill'

interface TotpSetup {
  secret: string
  otpauth_uri: string
  /** data: URL for an <img>. */
  qr_svg: string
}

const APPROVER_ROLES = ['owner', 'finance']

function onlyDigits(v: string): string {
  return v.replace(/\D/g, '').slice(0, 6)
}

/** Settings card: change password, two-factor authentication, and the company-wide 2FA policy for approvers. */
export function SecurityCard() {
  const { user, company, refresh, setCompany, provider } = useAuth()
  const toast = useToast()
  const supabaseMode = provider === 'supabase'
  const canSetPolicy = !!user?.role && APPROVER_ROLES.includes(user.role)

  // ---- Change password ----
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwError(null)
    if (next.length < 8) {
      setPwError('New password must be at least 8 characters.')
      return
    }
    if (next !== confirm) {
      setPwError('New passwords do not match.')
      return
    }
    setPwBusy(true)
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next })
      toast.success('Password changed.')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setPwError(errorMessage(err))
    } finally {
      setPwBusy(false)
    }
  }

  // ---- Two-factor: set up and activate ----
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [activateCode, setActivateCode] = useState('')
  const [activateBusy, setActivateBusy] = useState(false)
  const [totpError, setTotpError] = useState<string | null>(null)

  const startSetup = async () => {
    setTotpError(null)
    setSetupBusy(true)
    try {
      const { data } = await api.post<TotpSetup>('/auth/2fa/setup')
      setSetup(data)
      setActivateCode('')
    } catch (err) {
      setTotpError(errorMessage(err))
    } finally {
      setSetupBusy(false)
    }
  }

  const activate = async (e: FormEvent) => {
    e.preventDefault()
    setTotpError(null)
    setActivateBusy(true)
    try {
      await api.post('/auth/2fa/enable', { code: activateCode.trim() })
      toast.success('2FA is on')
      setSetup(null)
      setActivateCode('')
      await refresh()
    } catch (err) {
      setTotpError(errorMessage(err))
    } finally {
      setActivateBusy(false)
    }
  }

  // ---- Two-factor: turn off ----
  const [offOpen, setOffOpen] = useState(false)
  const [offPassword, setOffPassword] = useState('')
  const [offCode, setOffCode] = useState('')
  const [offBusy, setOffBusy] = useState(false)

  const disable = async (e: FormEvent) => {
    e.preventDefault()
    setTotpError(null)
    setOffBusy(true)
    try {
      await api.post('/auth/2fa/disable', { password: offPassword, code: offCode.trim() })
      toast.success('2FA is off.')
      setOffOpen(false)
      setOffPassword('')
      setOffCode('')
      await refresh()
    } catch (err) {
      setTotpError(errorMessage(err))
    } finally {
      setOffBusy(false)
    }
  }

  // ---- Company policy ----
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)

  const setPolicy = async (require_2fa_for_approvers: boolean) => {
    setPolicyError(null)
    setPolicyBusy(true)
    try {
      const { data } = await api.patch<Company>('/company', { require_2fa_for_approvers })
      setCompany(data)
      toast.success(require_2fa_for_approvers ? 'Approvers now need 2FA.' : '2FA is optional for approvers.')
    } catch (err) {
      setPolicyError(errorMessage(err))
    } finally {
      setPolicyBusy(false)
    }
  }

  const enabled = user?.totp_enabled ?? false

  return (
    <section id="security" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-brand" />
        <h3 className="font-bold">Security</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-4">Your password and second factor. Approvals are only as safe as the account that makes them.</p>

      {/* Change password (builtin auth only; Supabase manages credentials itself) */}
      {supabaseMode ? (
        <p className="rounded-input border border-line bg-lavender px-3 py-2 text-xs text-neutral-600">
          Password and email are managed by your sign-in. Use Forgot password on the sign-in page to change it.
        </p>
      ) : (
      <form onSubmit={changePassword} className="space-y-3">
        <h4 className="text-sm font-semibold">Change password</h4>
        <div>
          <label className="label" htmlFor="sec-current">Current password</label>
          <input
            id="sec-current"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="sec-next">New password</label>
            <input
              id="sec-next"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="sec-confirm">Confirm new password</label>
            <input
              id="sec-confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <ErrorNote message={pwError} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">At least 8 characters.</p>
          <button type="submit" className="btn-secondary" disabled={pwBusy || !current || !next || !confirm}>
            {pwBusy && <Spinner />} Save
          </button>
        </div>
      </form>
      )}

      <hr className="border-line my-5" />

      {/* Two-factor authentication */}
      <div>
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-neutral-500" />
          <h4 className="text-sm font-semibold">Two-factor authentication</h4>
          {enabled && (
            <StatusPill tone="green" dot>
              On
            </StatusPill>
          )}
        </div>

        {!enabled && (
          <div className="mt-2">
            <p className="text-xs text-neutral-600">Protect approvals with a 6-digit code from an authenticator app.</p>
            {!setup && (
              <button type="button" className="btn-primary mt-3" onClick={startSetup} disabled={setupBusy}>
                {setupBusy && <Spinner />} Set up 2FA
              </button>
            )}
            {setup && (
              <form onSubmit={activate} className="mt-3 rounded-card border border-line bg-lavender p-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-4">
                  <img
                    src={setup.qr_svg}
                    alt="QR code for your authenticator app"
                    width={180}
                    height={180}
                    className="h-[180px] w-[180px] shrink-0 rounded-card border border-line bg-white p-2"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs text-neutral-600">
                      Scan with Google Authenticator, 1Password, Authy or any TOTP app. Cannot scan? Enter this key manually.
                    </p>
                    <CopyBox value={setup.secret} />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="sec-activate-code">Code from the app</label>
                  <div className="flex gap-2">
                    <input
                      id="sec-activate-code"
                      className="input tnum tracking-widest sm:w-40"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="123456"
                      required
                      value={activateCode}
                      onChange={(e) => setActivateCode(onlyDigits(e.target.value))}
                    />
                    <button type="submit" className="btn-primary" disabled={activateBusy || activateCode.length !== 6}>
                      {activateBusy && <Spinner />} Activate
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setSetup(null)
                        setTotpError(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {enabled && (
          <div className="mt-2">
            <p className="text-xs text-neutral-600">Every sign-in asks for a 6-digit code from your authenticator app.</p>
            {!offOpen && (
              <button
                type="button"
                className="btn-secondary mt-3"
                onClick={() => {
                  setOffOpen(true)
                  setTotpError(null)
                }}
              >
                Turn off
              </button>
            )}
            {offOpen && (
              <form onSubmit={disable} className="mt-3 rounded-card border border-line bg-lavender p-4 space-y-3">
                <p className="text-xs text-neutral-600">Confirm with your password and a current code.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="sec-off-password">Password</label>
                    <input
                      id="sec-off-password"
                      type="password"
                      className="input"
                      autoComplete="current-password"
                      required
                      value={offPassword}
                      onChange={(e) => setOffPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="sec-off-code">Authentication code</label>
                    <input
                      id="sec-off-code"
                      className="input tnum tracking-widest"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="123456"
                      required
                      value={offCode}
                      onChange={(e) => setOffCode(onlyDigits(e.target.value))}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="btn-danger" disabled={offBusy || !offPassword || offCode.length !== 6}>
                    {offBusy && <Spinner />} Turn off 2FA
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setOffOpen(false)
                      setTotpError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <ErrorNote message={totpError} className="mt-3" />
      </div>

      {/* Company policy */}
      {canSetPolicy && (
        <>
          <hr className="border-line my-5" />
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-neutral-500" />
              <h4 className="text-sm font-semibold">Company policy</h4>
            </div>
            <label className="mt-2 flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 accent-brand"
                checked={company?.require_2fa_for_approvers ?? false}
                disabled={policyBusy}
                onChange={(e) => void setPolicy(e.target.checked)}
              />
              <span>
                <span className="font-semibold">Require 2FA for everyone who can approve</span>
                <span className="block text-xs text-neutral-500">Approvers without 2FA cannot approve or reject until they enable it.</span>
              </span>
            </label>
            <ErrorNote message={policyError} className="mt-3" />
          </div>
        </>
      )}
    </section>
  )
}
