'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Environment } from '@/types/environments'
import { Folder, Plus, MoreHorizontal, Trash2, Edit, Users, TrendingUp, Mail, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateEnvironmentModal } from './CreateEnvironmentModal'
import { deleteEnvironment } from './actions'
import { useToast } from '@/components/ToastProvider'

type Props = {
  environments: Environment[]
}

export function EnvironmentsList({ environments }: Props) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [envList, setEnvList] = useState(environments)
  const { success: toastSuccess, error: toastError } = useToast()

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Sei sicuro di voler eliminare l'ambiente "${name}"?`)) return

    const result = await deleteEnvironment(id)
    if (result.success) {
      setEnvList((prev) => prev.filter((e) => e.id !== id))
      toastSuccess('Ambiente eliminato')
    } else {
      toastError(result.error || "Errore durante l'eliminazione")
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="border-2 border-dashed border-gray-300 rounded-xl p-6 hover:border-purple-400 hover:bg-purple-50/50 transition-all group flex flex-col items-center justify-center min-h-[200px]"
        >
          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-colors">
            <Plus className="w-6 h-6 text-purple-600" />
          </div>
          <span className="mt-3 font-medium text-gray-600 group-hover:text-purple-600">
            Nuovo Ambiente
          </span>
        </button>

        {envList.map((env) => (
          <div
            key={env.id}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow relative group"
          >
            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Edit className="mr-2 h-4 w-4" />
                    Modifica
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(env.id, env.name)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Elimina
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Link href={`/dashboard/environments/${env.id}`}>
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${env.color}20` }}
                >
                  <Folder className="w-5 h-5" style={{ color: env.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{env.name}</h3>
                  {env.description && <p className="text-sm text-gray-500 truncate">{env.description}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{env.stats?.total_leads || 0} lead</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">Score: {env.stats?.avg_score || 0}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{env.stats?.leads_with_email || 0} email</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{env.stats?.leads_with_phone || 0} tel</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  Aggiornato {new Date(env.updated_at).toLocaleDateString('it-IT')}
                </span>
                <span
                  className="text-xs font-medium px-2 py-1 rounded-full"
                  style={{ backgroundColor: `${env.color}20`, color: env.color }}
                >
                  {env.search_ids?.length || 0} ricerche
                </span>
              </div>
            </Link>
          </div>
        ))}
      </div>

      {envList.length === 0 && (
        <div className="text-center py-12">
          <Folder className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Nessun ambiente</h3>
          <p className="text-gray-500 mt-1">Crea il tuo primo ambiente per organizzare i lead</p>
        </div>
      )}

      <CreateEnvironmentModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(env) => {
          setEnvList((prev) => [env, ...prev])
          setIsCreateOpen(false)
        }}
      />
    </>
  )
}
