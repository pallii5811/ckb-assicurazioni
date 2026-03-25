'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Brain, TrendingUp, Target, Zap, Trophy, Phone, CheckCircle, XCircle,
  Euro, ArrowUpRight, ArrowDownRight, Minus, BarChart3, Loader2, Lightbulb,
  Flame, Clock, MapPin
} from 'lucide-react'

type PipelineItem = {
  id: string; stage: string; deal_value: number; lead_category: string | null
  lead_city: string | null; created_at: string; updated_at: string
}

type ConversionStats = {
  total_contacted: number; total_converted: number; total_rejected: number; conversion_rate: number
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

function TrendIndicator({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value > 0) return <span className="text-emerald-600 text-xs font-bold flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" />+{value}{suffix}</span>
  if (value < 0) return <span className="text-red-500 text-xs font-bold flex items-center gap-0.5"><ArrowDownRight className="w-3 h-3" />{value}{suffix}</span>
  return <span className="text-slate-400 text-xs flex items-center gap-0.5"><Minus className="w-3 h-3" />0{suffix}</span>
}

function InsightCard({ icon: Icon, color, title, children }: { icon: any; color: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h3 className="font-bold text-sm text-slate-900">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export default function InsightsPage() {
  const [pipeline, setPipeline] = useState<PipelineItem[]>([])
  const [stats, setStats] = useState<ConversionStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/pipeline', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ items: [] })),
      fetch('/api/insights/stats', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([pData, sData]) => {
      setPipeline(pData?.items || [])
      setStats(sData)
      setLoading(false)
    })
  }, [])

  const insights = useMemo(() => {
    const won = pipeline.filter(p => p.stage === 'vinto')
    const lost = pipeline.filter(p => p.stage === 'perso')
    const active = pipeline.filter(p => !['vinto', 'perso'].includes(p.stage))
    const totalRevenue = won.reduce((s, p) => s + (p.deal_value || 0), 0)
    const pipelineValue = active.reduce((s, p) => s + (p.deal_value || 0), 0)
    const avgDealSize = won.length > 0 ? Math.round(totalRevenue / won.length) : 0
    const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

    // Category analysis
    const catMap = new Map<string, { won: number; total: number; revenue: number }>()
    for (const p of pipeline) {
      const cat = p.lead_category || 'Altro'
      const existing = catMap.get(cat) || { won: 0, total: 0, revenue: 0 }
      existing.total++
      if (p.stage === 'vinto') { existing.won++; existing.revenue += p.deal_value || 0 }
      catMap.set(cat, existing)
    }
    const bestCategories = Array.from(catMap.entries())
      .map(([cat, d]) => ({ category: cat, winRate: d.total > 0 ? Math.round((d.won / d.total) * 100) : 0, revenue: d.revenue, total: d.total }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // City analysis
    const cityMap = new Map<string, number>()
    for (const p of pipeline) {
      const city = p.lead_city || 'Altro'
      cityMap.set(city, (cityMap.get(city) || 0) + 1)
    }
    const topCities = Array.from(cityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    // Stage funnel
    const funnel = [
      { stage: 'Nuovo', count: pipeline.filter(p => p.stage === 'nuovo').length },
      { stage: 'Contattato', count: pipeline.filter(p => p.stage === 'contattato').length },
      { stage: 'Meeting', count: pipeline.filter(p => p.stage === 'meeting').length },
      { stage: 'Proposta', count: pipeline.filter(p => p.stage === 'proposta').length },
      { stage: 'Vinto', count: won.length },
      { stage: 'Perso', count: lost.length },
    ]
    const maxFunnel = Math.max(...funnel.map(f => f.count), 1)

    // AI tips
    const tips: string[] = []
    if (active.length > 0 && won.length === 0) tips.push('Hai deal in pipeline ma nessuna chiusura ancora. Concentrati sul follow-up dei meeting!')
    if (winRate >= 40) tips.push(`Il tuo win rate del ${winRate}% è eccellente! Sei sopra la media di settore.`)
    if (winRate > 0 && winRate < 20) tips.push('Il tuo win rate è sotto il 20%. Valuta di qualificare meglio i lead prima di contattarli.')
    if (bestCategories.length > 0 && bestCategories[0].revenue > 0) tips.push(`La tua categoria migliore è "${bestCategories[0].category}" con ${formatCurrency(bestCategories[0].revenue)} di revenue. Focalizzati lì!`)
    if (active.some(p => { const days = Math.floor((Date.now() - new Date(p.updated_at).getTime()) / 86400000); return days > 7 })) tips.push('Alcuni deal sono fermi da più di 7 giorni. Ricontatta i lead stagnanti per non perderli.')
    if (pipeline.length === 0) tips.push('La tua pipeline è vuota! Vai alla Ricerca e inizia a trovare lead da aggiungere alla pipeline.')
    if (avgDealSize > 0) tips.push(`Il tuo deal medio è ${formatCurrency(avgDealSize)}. Per scalare, prova ad alzare il ticket con up-sell.`)
    if (tips.length === 0) tips.push('Continua così! Aggiungi più deal alla pipeline per sbloccare insight avanzati.')

    return { totalRevenue, pipelineValue, avgDealSize, winRate, won: won.length, lost: lost.length, active: active.length, bestCategories, topCities, funnel, maxFunnel, tips }
  }, [pipeline])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        <span className="ml-2 text-slate-500">Analisi in corso...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
          <Brain className="w-7 h-7 text-violet-600" /> Smart Insights
        </h1>
        <p className="mt-1 text-sm text-slate-500">Analisi intelligente del tuo processo di vendita. Aggiornato in tempo reale.</p>
      </div>

      {/* AI Tips */}
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-2xl border border-violet-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-violet-600" />
          <span className="font-bold text-sm text-violet-900">Suggerimenti AI</span>
        </div>
        <div className="space-y-2">
          {insights.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2">
              <Zap className="w-3.5 h-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-slate-700">{tip}</span>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Revenue Totale', value: formatCurrency(insights.totalRevenue), icon: Euro, color: 'bg-emerald-500' },
          { label: 'Pipeline Attiva', value: formatCurrency(insights.pipelineValue), icon: TrendingUp, color: 'bg-blue-500' },
          { label: 'Deal Medio', value: formatCurrency(insights.avgDealSize), icon: Target, color: 'bg-amber-500' },
          { label: 'Win Rate', value: `${insights.winRate}%`, icon: Trophy, color: 'bg-violet-500' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${kpi.color}`}>
                <kpi.icon className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-medium text-slate-500">{kpi.label}</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion Funnel */}
        <InsightCard icon={BarChart3} color="bg-indigo-500" title="Funnel di Conversione">
          <div className="space-y-2.5">
            {insights.funnel.map(f => (
              <div key={f.stage} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-20 font-medium">{f.stage}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(8, (f.count / insights.maxFunnel) * 100)}%` }}
                  >
                    {f.count > 0 && <span className="text-[10px] font-bold text-white">{f.count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </InsightCard>

        {/* Best Categories */}
        <InsightCard icon={Flame} color="bg-orange-500" title="Categorie Migliori">
          {insights.bestCategories.length > 0 ? (
            <div className="space-y-3">
              {insights.bestCategories.map((cat, i) => (
                <div key={cat.category} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 w-4">{i + 1}.</span>
                    <span className="text-sm font-medium text-slate-700">{cat.category}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{cat.total} deal</span>
                    {cat.revenue > 0 && <span className="text-xs font-bold text-emerald-600">{formatCurrency(cat.revenue)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Aggiungi lead con categorie alla pipeline per vedere i dati.</p>
          )}
        </InsightCard>

        {/* Top Cities */}
        <InsightCard icon={MapPin} color="bg-cyan-500" title="Città Principali">
          {insights.topCities.length > 0 ? (
            <div className="space-y-3">
              {insights.topCities.map(([city, count], i) => (
                <div key={city} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 w-4">{i + 1}.</span>
                    <span className="text-sm font-medium text-slate-700">{city}</span>
                  </div>
                  <span className="text-xs text-slate-400">{count} lead</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Aggiungi lead con città alla pipeline per vedere i dati.</p>
          )}
        </InsightCard>

        {/* Conversion Stats from interactions */}
        <InsightCard icon={Target} color="bg-violet-500" title="Attività di Outreach">
          {stats ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-slate-500 mb-1"><Phone className="w-3 h-3" /> Contattati</div>
                <div className="text-xl font-bold text-slate-900">{stats.total_contacted}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-emerald-600 mb-1"><CheckCircle className="w-3 h-3" /> Convertiti</div>
                <div className="text-xl font-bold text-emerald-700">{stats.total_converted}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-red-500 mb-1"><XCircle className="w-3 h-3" /> Scartati</div>
                <div className="text-xl font-bold text-red-600">{stats.total_rejected}</div>
              </div>
              <div className="bg-violet-50 rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-violet-600 mb-1"><TrendingUp className="w-3 h-3" /> Tasso</div>
                <div className="text-xl font-bold text-violet-700">{stats.conversion_rate}%</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Contatta lead dalla tabella risultati per tracciare le conversioni.</p>
          )}
        </InsightCard>
      </div>
    </div>
  )
}
