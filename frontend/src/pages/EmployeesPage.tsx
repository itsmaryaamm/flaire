import { useState } from 'react'
import { Plus, Bot } from 'lucide-react'
import { api } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import type { Agent, Department } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Modal } from '../components/Modal'
import { AgentForm } from '../components/AgentForm'
import { ApiKeyReveal } from '../components/ApiKeyReveal'
import { EmptyState } from '../components/EmptyState'
import { PageLoader } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { EmployeeCard } from '../components/employees/EmployeeCard'
import { useT } from '../lib/i18n'

export default function EmployeesPage() {
  const t = useT()
  const agents = useFetch(() => api.get<Agent[]>('/agents').then((r) => r.data), [])
  const departments = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null)

  const list = agents.data ?? []
  const newButton = (
    <button className="btn-primary" onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4" /> {t('employees.new')}
    </button>
  )

  return (
    <div>
      <PageHeader title={t('employees.title')} subtitle={t('employees.subtitle')} actions={newButton} />

      {agents.loading && !agents.data ? (
        <PageLoader />
      ) : agents.error && !agents.data ? (
        <ErrorNote message={agents.error} />
      ) : list.length === 0 ? (
        <div className="card-lg">
          <EmptyState icon={<Bot className="h-5 w-5" />} title={t('employees.noneYet')} description={t('employees.noneYetDesc')} action={newButton} />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((a) => (
            <EmployeeCard key={a.id} agent={a} />
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('employees.new')} size="lg">
        <AgentForm
          departments={departments.data ?? []}
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            void agents.refetch()
          }}
          onCreated={(agent, key) => setCreated({ key, name: agent.name })}
        />
      </Modal>

      <ApiKeyReveal apiKey={created?.key ?? null} agentName={created?.name} onClose={() => setCreated(null)} />
    </div>
  )
}
