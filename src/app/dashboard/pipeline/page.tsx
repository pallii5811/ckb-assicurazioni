'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, GripVertical, Phone, Mail, Globe, MapPin, Tag, Trophy,
  Sparkles, Calendar, FileText, XCircle, ChevronRight, Trash2,
  DollarSign, StickyNote, X, Loader2, TrendingUp, Users, Target, Euro
} from 'lucide-react'

type PipelineItem = {
  id: string
  lead_name: string
  lead_website: string | null
  lead_phone: string | null
  lead_email: string | null
  lead_city: string | null
  lead_category: string | null
  lead_score: number
  stage: string
  deal_value: number
  notes: string | null
  next_action: string | null
  next_action_date: string | null
  created_at: string
  updated_at: string
}

const STAGES = [
  { id: 'nuovo', label: 'Nuovo', color: 'bg-blue-500', lightBg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: Sparkles },
  { id: 'contattato', label: 'Contattato', color: 'bg-violet-500', lightBg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', icon: Phone },
  { id: 'meeting', label: 'Meeting', color: 'bg-amber-500', lightBg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: Calendar },
  { id: 'proposta', label: 'Proposta', color: 'bg-orange-500', lightBg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: FileText },
  { id: 'vinto', label: 'Vinto', color: 'bg-emerald-500', lightBg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: Trophy },
  { id: 'perso', label: 'Perso', color: 'bg-slate-400', lightBg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', icon: XCircle },
]

const EMPTY_FORM = {
  lead_name: '', lead_website: '', lead_phone: '', lead_email: '',
  lead_city: '', lead_category: '', lead_score: 0, deal_value: 0, notes: '', stage: 'nuovo',
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

function daysSince(dateStr: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000))
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 75 ? 'bg-emerald-100 text-emerald-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${color}`}>{score}</span>
}

export default function PipelinePage() {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Errore caricamento')
      setItems(data.items || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  const handleSave = async () => {
    if (!form.lead_name.trim()) return
    setSaving(true)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const body = editingId ? { id: editingId, ...form } : form
      const res = await fetch('/api/pipeline', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Errore')
      if (editingId) {
        setItems(prev => prev.map(i => i.id === editingId ? data.item : i))
      } else {
        setItems(prev => [data.item, ...prev])
      }
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleStageChange = async (item: PipelineItem, newStage: string) => {
    const prev = items
    setItems(items.map(i => i.id === item.id ? { ...i, stage: newStage, updated_at: new Date().toISOString() } : i))
    try {
      const res = await fetch('/api/pipeline', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, stage: newStage }),
      })
      if (!res.ok) setItems(prev)
    } catch { setItems(prev) }
  }

  const handleDelete = async (id: string) => {
    const prev = items
    setItems(items.filter(i => i.id !== id))
    try {
      const res = await fetch('/api/pipeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) setItems(prev)
    } catch { setItems(prev) }
  }

  const openEdit = (item: PipelineItem) => {
    setForm({
      lead_name: item.lead_name,
      lead_website: item.lead_website || '',
      lead_phone: item.lead_phone || '',
      lead_email: item.lead_email || '',
      lead_city: item.lead_city || '',
      lead_category: item.lead_category || '',
      lead_score: item.lead_score,
      deal_value: item.deal_value,
      notes: item.notes || '',
      stage: item.stage,
    })
    setEditingId(item.id)
    setShowForm(true)
  }

  const stats = useMemo(() => {
    const active = items.filter(i => !['vinto', 'perso'].includes(i.stage))
    const won = items.filter(i => i.stage === 'vinto')
    const totalRevenue = won.reduce((s, i) => s + (i.deal_value || 0), 0)
    const pipelineValue = active.reduce((s, i) => s + (i.deal_value || 0), 0)
    const winRate = items.length > 0 ? Math.round((won.length / Math.max(1, won.length + items.filter(i => i.stage === 'perso').length)) * 100) : 0
    return { totalDeals: items.length, activeDeals: active.length, totalRevenue, pipelineValue, winRate }
  }, [items])

  const grouped = useMemo(() => {
    const map: Record<string, PipelineItem[]> = {}
    for (const s of STAGES) map[s.id] = []
    for (const item of items) {
      if (map[item.stage]) map[item.stage].push(item)
      else map['nuovo'].push(item)
    }
    return map
  }, [items])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Pipeline di Vendita</h1>
          <p className="mt-1 text-sm text-slate-500">Gestisci il tuo processo di vendita. Dalla scoperta alla chiusura.</p>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true) }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all"
        >
          <Plus className="w-4 h-4" /> Aggiungi Lead
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Deal Totali', value: stats.totalDeals, icon: Users, color: 'text-violet-600' },
          { label: 'In Corso', value: stats.activeDeals, icon: Target, color: 'text-blue-600' },
          { label: 'Valore Pipeline', value: formatCurrency(stats.pipelineValue), icon: TrendingUp, color: 'text-amber-600' },
          { label: 'Revenue Chiuso', value: formatCurrency(stats.totalRevenue), icon: Euro, color: 'text-emerald-600' },
          { label: 'Win Rate', value: `${stats.winRate}%`, icon: Trophy, color: 'text-orange-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs font-medium text-slate-500">{s.label}</span>
            </div>
            <div className="text-xl font-bold text-slate-900">{s.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}
          <button onClick={() => setError(null)} className="ml-2 underline">Chiudi</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          <span className="ml-2 text-slate-500">Caricamento pipeline...</span>
        </div>
      ) : (
        /* Kanban Board */
        <div className="overflow-x-auto pb-4 -mx-2 px-2">
          <div className="flex gap-3 min-w-[1100px]">
            {STAGES.map(stage => {
              const stageItems = grouped[stage.id]
              const stageValue = stageItems.reduce((s, i) => s + (i.deal_value || 0), 0)
              return (
                <div key={stage.id} className="flex-1 min-w-[170px]">
                  {/* Column Header */}
                  <div className={`rounded-xl ${stage.lightBg} ${stage.border} border p-3 mb-3`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                        <span className={`text-xs font-bold uppercase tracking-wider ${stage.text}`}>{stage.label}</span>
                      </div>
                      <span className={`text-xs font-bold ${stage.text} bg-white/80 px-2 py-0.5 rounded-full`}>{stageItems.length}</span>
                    </div>
                    {stageValue > 0 && <div className="text-[11px] font-medium text-slate-500 mt-1">{formatCurrency(stageValue)}</div>}
                  </div>

                  {/* Cards */}
                  <div className="space-y-2">
                    {stageItems.map(item => {
                      const isExpanded = expandedId === item.id
                      const stageIdx = STAGES.findIndex(s => s.id === item.stage)
                      const nextStage = stageIdx < STAGES.length - 2 ? STAGES[stageIdx + 1] : null
                      return (
                        <div
                          key={item.id}
                          className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-violet-300 transition-all cursor-pointer group"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-sm text-slate-900 truncate">{item.lead_name}</div>
                                {item.lead_website && (
                                  <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-400 truncate">
                                    <Globe className="w-3 h-3 flex-shrink-0" />{item.lead_website}
                                  </div>
                                )}
                              </div>
                              <ScoreBadge score={item.lead_score} />
                            </div>

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {item.deal_value > 0 && (
                                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                  {formatCurrency(item.deal_value)}
                                </span>
                              )}
                              {item.lead_city && (
                                <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                  <MapPin className="w-2.5 h-2.5" />{item.lead_city}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-300 ml-auto">{daysSince(item.updated_at)}g</span>
                            </div>

                            {/* Expanded Details */}
                            {isExpanded && (
                              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2" onClick={e => e.stopPropagation()}>
                                {item.lead_phone && (
                                  <div className="flex items-center gap-2 text-xs text-slate-600">
                                    <Phone className="w-3 h-3 text-slate-400" />{item.lead_phone}
                                  </div>
                                )}
                                {item.lead_email && (
                                  <div className="flex items-center gap-2 text-xs text-slate-600">
                                    <Mail className="w-3 h-3 text-slate-400" />{item.lead_email}
                                  </div>
                                )}
                                {item.lead_category && (
                                  <div className="flex items-center gap-2 text-xs text-slate-600">
                                    <Tag className="w-3 h-3 text-slate-400" />{item.lead_category}
                                  </div>
                                )}
                                {item.notes && (
                                  <div className="flex items-start gap-2 text-xs text-slate-600">
                                    <StickyNote className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                                    <span className="line-clamp-3">{item.notes}</span>
                                  </div>
                                )}

                                <div className="flex items-center gap-1.5 pt-2">
                                  {nextStage && (
                                    <button
                                      onClick={() => handleStageChange(item, nextStage.id)}
                                      className={`text-[11px] font-semibold px-2 py-1 rounded-lg ${nextStage.lightBg} ${nextStage.text} ${nextStage.border} border flex items-center gap-1 hover:opacity-80 transition`}
                                    >
                                      <ChevronRight className="w-3 h-3" />{nextStage.label}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => openEdit(item)}
                                    className="text-[11px] font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                                  >
                                    Modifica
                                  </button>
                                  <button
                                    onClick={() => handleDelete(item.id)}
                                    className="text-[11px] px-1.5 py-1 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition ml-auto"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>

                                {item.stage !== 'vinto' && item.stage !== 'perso' && (
                                  <div className="flex gap-1.5 pt-1">
                                    <button
                                      onClick={() => handleStageChange(item, 'vinto')}
                                      className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100"
                                    >
                                      ✓ Vinto
                                    </button>
                                    <button
                                      onClick={() => handleStageChange(item, 'perso')}
                                      className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-500 border border-red-200 hover:bg-red-100"
                                    >
                                      ✗ Perso
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {stageItems.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
                        <div className="text-xs text-slate-400">Nessun deal</div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => { setShowForm(false); setEditingId(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Modifica Deal' : 'Nuovo Deal'}</h2>
              <button onClick={() => { setShowForm(false); setEditingId(null) }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nome Azienda *</label>
                  <input value={form.lead_name} onChange={e => setForm(f => ({ ...f, lead_name: e.target.value }))} placeholder="Es. Ristorante Roma" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Sito Web</label>
                  <input value={form.lead_website} onChange={e => setForm(f => ({ ...f, lead_website: e.target.value }))} placeholder="www.example.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Telefono</label>
                  <input value={form.lead_phone} onChange={e => setForm(f => ({ ...f, lead_phone: e.target.value }))} placeholder="+39 333..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                  <input value={form.lead_email} onChange={e => setForm(f => ({ ...f, lead_email: e.target.value }))} placeholder="info@..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Città</label>
                  <input value={form.lead_city} onChange={e => setForm(f => ({ ...f, lead_city: e.target.value }))} placeholder="Milano" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Categoria</label>
                  <input value={form.lead_category} onChange={e => setForm(f => ({ ...f, lead_category: e.target.value }))} placeholder="Ristorante" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Score (0-100)</label>
                  <input type="number" min={0} max={100} value={form.lead_score} onChange={e => setForm(f => ({ ...f, lead_score: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Valore Deal (€)</label>
                  <input type="number" min={0} value={form.deal_value} onChange={e => setForm(f => ({ ...f, deal_value: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Fase</label>
                  <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none bg-white">
                    {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Note</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Note, contesto, prossimi passi..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none resize-none" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-100">
              <button onClick={() => { setShowForm(false); setEditingId(null) }} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Annulla</button>
              <button onClick={handleSave} disabled={saving || !form.lead_name.trim()} className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold shadow-lg disabled:opacity-50 hover:shadow-violet-500/40 transition-all flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Salva Modifiche' : 'Aggiungi Deal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
