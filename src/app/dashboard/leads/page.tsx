"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  Eye,
  ListPlus,
  Radar,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'

type DomainList = {
  id: string
  name: string
  description: string | null
  created_at: string
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-violet-500/15 bg-slate-900/40 px-4 py-3 backdrop-blur-xl">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/15 to-blue-500/10 text-violet-200">
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-semibold tracking-wide text-white/55">{label}</div>
        <div className="text-lg font-extrabold text-white leading-tight">{value}</div>
      </div>
    </div>
  )
}

function scoreTone(score: number) {
  if (score >= 85) return 'from-emerald-400 to-cyan-300'
  if (score >= 65) return 'from-violet-400 to-cyan-300'
  return 'from-fuchsia-400 to-violet-300'
}

export default function LeadsPage() {
  const [lists, setLists] = useState<DomainList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch('/api/lists', { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { lists?: DomainList[]; error?: string } | null

        if (!res.ok) {
          throw new Error(data?.error || 'Impossibile caricare le liste.')
        }

        setLists(Array.isArray(data?.lists) ? data!.lists! : [])
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Errore durante il caricamento.'
        setError(raw)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [])

  const totalLeads = 0
  const activeLists = lists.length
  const verifiedEmails = 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Le Tue Liste di Dominio</div>
          <div className="mt-1 text-sm text-slate-600">
            Organizza il tuo territorio. Ogni lista è un modulo del tuo ecosistema di vendita automatizzato.
          </div>
        </div>

        <Button
          type="button"
          className="h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white font-semibold shadow-[0_18px_70px_-30px_rgba(34,211,238,0.55)] hover:shadow-[0_22px_80px_-28px_rgba(168,85,247,0.55)] transition-all duration-200"
          onClick={() => {
            window.location.href = '/dashboard'
          }}
        >
          <ListPlus className="mr-2 h-5 w-5" />
          Crea Nuova Lista
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatPill icon={<Users className="h-5 w-5" />} label="Totale Lead Salvati" value={totalLeads.toLocaleString('it-IT')} />
        <StatPill icon={<Radar className="h-5 w-5" />} label="Liste Attive" value={activeLists.toLocaleString('it-IT')} />
        <StatPill
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Email Verificate"
          value={verifiedEmails.toLocaleString('it-IT')}
        />
      </div>

      {error ? (
        <Card className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5 backdrop-blur-xl">
          <div className="text-sm font-semibold text-red-200">{error}</div>
        </Card>
      ) : null}

      {loading ? (
        <Card className="rounded-3xl border border-violet-500/15 bg-slate-900/45 p-6 backdrop-blur-xl">
          <div className="text-sm text-white/70">Caricamento liste…</div>
        </Card>
      ) : null}

      {!loading && lists.length === 0 ? (
        <Card className="relative overflow-hidden rounded-3xl border border-violet-500/20 bg-slate-900/45 p-10 shadow-[0_25px_90px_-55px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <div className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="h-20 w-20 rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/15 to-cyan-500/10 flex items-center justify-center">
                <Radar className="h-10 w-10 text-violet-200" />
              </div>
              <div className="absolute inset-0 rounded-3xl border border-violet-400/20 animate-pulse" />
            </div>
            <div className="text-2xl font-extrabold text-white">Ancora nessun territorio conquistato.</div>
            <div className="mt-2 text-sm text-white/65">
              Inizia una scansione e salva i tuoi primi lead per vederli apparire qui.
            </div>

            <Button asChild className="mt-6 h-12 px-6 rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-500">
              <Link href="/dashboard">
                Vai a Scansiona Mercato <ArrowUpRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </Card>
      ) : !loading ? (
        <div className="space-y-3">
          {lists.map((list) => (
            <Card
              key={list.id}
              className="group relative overflow-hidden rounded-3xl border border-violet-500/15 bg-slate-900/45 p-5 shadow-[0_18px_70px_-50px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A855F7] hover:shadow-[0_20px_80px_-45px_rgba(168,85,247,0.35)]"
            >
              <div className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl" />
              </div>

              <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="truncate text-base md:text-lg font-extrabold text-white">{list.name}</div>
                    {list.description ? (
                      <Badge className="bg-white/5 text-white/70 border border-white/10">{list.description}</Badge>
                    ) : null}
                    <div className="ml-auto md:ml-0 flex items-center">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/35 text-sm font-extrabold text-white">
                        —
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-3">
                      <div className="text-[11px] font-semibold tracking-wide text-white/55">Media Nexa Score</div>
                      <div className="mt-2 flex items-center gap-3">
                        <Progress value={0} className="h-2 bg-white/10" />
                        <div className="text-xs font-bold text-white/80 w-10 text-right">—</div>
                      </div>
                      <div className={`mt-2 h-1 w-full rounded-full bg-gradient-to-r ${scoreTone(0)} opacity-70`} />
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-3 md:col-span-2">
                      <div className="text-[11px] font-semibold tracking-wide text-white/55">
                        Creato: {new Date(list.created_at).toLocaleDateString('it-IT')}
                      </div>
                      <div className="mt-2 text-xs text-white/60">
                        Azioni rapide: visualizza, esporta o invia la lista direttamente alle integrazioni attive.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 md:pl-6">
                  <button
                    type="button"
                    className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 transition"
                    title="Visualizza"
                  >
                    <Eye className="mx-auto h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 transition"
                    title="Export"
                  >
                    <ArrowUpRight className="mx-auto h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 transition"
                    title="Invia a..."
                  >
                    <Zap className="mx-auto h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  )
}
