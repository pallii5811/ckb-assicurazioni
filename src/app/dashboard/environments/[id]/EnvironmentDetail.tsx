'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Environment } from '@/types/environments'
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Users,
  Mail,
  Phone,
  TrendingUp,
  Globe,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { recalculateEnvironmentStats } from '../actions'
import { useToast } from '@/components/ToastProvider'
import { LeadEnrichmentPanel } from '@/components/LeadEnrichmentPanel'

type Props = {
  environment: Environment
  initialLeads: any[]
}

export function EnvironmentDetail({ environment, initialLeads }: Props) {
  const [leads] = useState(initialLeads)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [stats, setStats] = useState(environment.stats)
  const { success: toastSuccess, error: toastError } = useToast()

  const handleRefreshStats = async () => {
    setIsRefreshing(true)
    const result = await recalculateEnvironmentStats(environment.id)
    setIsRefreshing(false)

    if (result.success && result.stats) {
      setStats(result.stats)
      toastSuccess('Statistiche aggiornate')
    } else {
      toastError(result.error || 'Errore aggiornamento')
    }
  }

  const exportCSV = () => {
    if (leads.length === 0) {
      toastError('Nessun lead da esportare')
      return
    }

    const headers = ['Nome', 'Sito', 'Email', 'Telefono', 'Città', 'Categoria', 'Score']
    const rows = leads.map((l) => [
      l.nome || '',
      l.sito || '',
      l.email || '',
      l.telefono || '',
      l.citta || '',
      l.categoria || '',
      l.score || '',
    ])

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${environment.name.replace(/\s+/g, '_')}_leads.csv`
    link.click()

    toastSuccess('CSV scaricato')
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/dashboard/environments">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Indietro
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${environment.color}20` }}
          >
            <Users className="w-7 h-7" style={{ color: environment.color }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{environment.name}</h1>
            {environment.description && <p className="text-gray-500 mt-1">{environment.description}</p>}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshStats} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Aggiorna Stats
          </Button>
          <Button onClick={exportCSV}>
            <Download className="w-4 h-4 mr-2" />
            Esporta CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <Users className="w-4 h-4" />
            Lead Totali
          </div>
          <div className="text-2xl font-bold">{stats?.total_leads || 0}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <TrendingUp className="w-4 h-4" />
            Score Medio
          </div>
          <div className="text-2xl font-bold">{stats?.avg_score || 0}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <Mail className="w-4 h-4" />
            Con Email
          </div>
          <div className="text-2xl font-bold">{stats?.leads_with_email || 0}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <AlertCircle className="w-4 h-4" />
            Senza Pixel
          </div>
          <div className="text-2xl font-bold text-green-600">{stats?.leads_no_pixel || 0}</div>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left p-4 font-medium text-gray-600">Nome</th>
                <th className="text-left p-4 font-medium text-gray-600">Contatti</th>
                <th className="text-left p-4 font-medium text-gray-600">Città</th>
                <th className="text-left p-4 font-medium text-gray-600">Categoria</th>
                <th className="text-left p-4 font-medium text-gray-600">Score</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, idx) => (
                <tr key={idx} className="border-b hover:bg-gray-50">
                  <td className="p-4">
                    <div className="font-medium">{lead.nome}</div>
                    {lead.sito ? (
                      <a
                        href={lead.sito}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-purple-600 hover:underline flex items-center gap-1"
                      >
                        <Globe className="w-3 h-3" />
                        {(() => {
                          try {
                            return new URL(lead.sito).hostname
                          } catch {
                            return String(lead.sito)
                          }
                        })()}
                      </a>
                    ) : null}

                    {lead.sito ? <LeadEnrichmentPanel website={String(lead.sito)} leadName={String(lead.nome || '')} /> : null}
                  </td>
                  <td className="p-4">
                    {lead.email ? (
                      <div className="flex items-center gap-1 text-sm">
                        <Mail className="w-3 h-3 text-gray-400" />
                        {lead.email}
                      </div>
                    ) : null}
                    {lead.telefono ? (
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {lead.telefono}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-4 text-sm">{lead.citta || '-'}</td>
                  <td className="p-4 text-sm">{lead.categoria || '-'}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        (lead.score || 0) >= 70
                          ? 'bg-green-100 text-green-700'
                          : (lead.score || 0) >= 40
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {lead.score || 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {leads.length === 0 && (
          <div className="p-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">Nessun lead</h3>
            <p className="text-gray-500 mt-1">Aggiungi ricerche a questo ambiente per vedere i lead</p>
          </div>
        )}
      </div>
    </div>
  )
}
