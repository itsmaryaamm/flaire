import { useT } from '../../lib/i18n'
import { ROLES } from '../../types'
import type { PillTone } from '../StatusPill'
import { StatusPill } from '../StatusPill'

const TONES: Record<string, PillTone> = {
  owner: 'lavender',
  admin: 'blue',
  finance: 'green',
  dept_head: 'amber',
  auditor: 'neutral',
  viewer: 'neutral',
}

export function RolePill({ role }: { role: string }) {
  const t = useT()
  return <StatusPill tone={TONES[role] ?? 'neutral'}>{t(`role.${role}`)}</StatusPill>
}

/** Role select with a one-line description of the chosen role under it. */
export function RoleSelect({
  value,
  onChange,
  allowOwner,
  id,
  disabled,
}: {
  value: string
  onChange: (role: string) => void
  allowOwner: boolean
  id?: string
  disabled?: boolean
}) {
  const t = useT()
  const options = ROLES.filter((r) => r !== 'owner' || allowOwner)
  return (
    <div>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map((r) => (
          <option key={r} value={r}>
            {t(`role.${r}`)}
          </option>
        ))}
      </select>
      <p className="text-xs text-neutral-500 mt-1">{t(`role.${value}.desc`)}</p>
    </div>
  )
}
