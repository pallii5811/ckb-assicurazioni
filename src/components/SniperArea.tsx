'use client'

import { Sparkles, CreditCard } from 'lucide-react'

const LEAD_OPTIONS = [10, 25, 50, 100]

type SniperAreaProps = {
  query: string
  onQueryChange: (value: string) => void
  onStart: () => void | Promise<void>
  isLoading: boolean
  error: string | null
  aiDebug?: unknown
  maxLeads: number
  onMaxLeadsChange: (value: number) => void
  credits: number
}

const SniperArea = ({ query, onQueryChange, onStart, isLoading, error, aiDebug, maxLeads, onMaxLeadsChange, credits }: SniperAreaProps) => {

  return (
    <div className="relative mb-6">
      <div className="pointer-events-none absolute -inset-2 bg-gradient-to-r from-violet-500/10 via-blue-500/10 to-violet-500/10 rounded-3xl blur-2xl" />

      <div className="relative rounded-2xl border-2 border-transparent bg-white shadow-sm ring-1 ring-slate-200/70 overflow-hidden focus-within:border-violet-400">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onStart()
          }}
          className="px-4 sm:px-5 py-3"
        >
          {/* Row 1: input field — always full width */}
          <div className="flex items-center gap-3 mb-2 sm:mb-0">
            <div className="relative flex-shrink-0">
              <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />
              {!isLoading ? (
                <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-violet-400 animate-ping opacity-75" />
              ) : null}
            </div>

            <input
              type="text"
              placeholder="Scrivi chi cerchi (es. 'Ristoranti a Roma senza sito web')…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-500 outline-none py-3 min-w-0"
            />
          </div>

          {/* Row 2: controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Lead limit selector */}
            <div className="flex-shrink-0 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={maxLeads}
                onChange={(e) => onMaxLeadsChange(Number(e.target.value))}
                disabled={isLoading}
                className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 px-2 py-1.5 outline-none focus:border-violet-400 transition-colors cursor-pointer disabled:opacity-50"
              >
                {LEAD_OPTIONS.map((n) => (
                  <option key={n} value={n} disabled={n > credits}>
                    {n} lead{n > credits ? ` (servono ${n} crediti)` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-400 font-mono">⌘</kbd>
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-400 font-mono">↵</kbd>
            </div>

            <button
              type="submit"
              disabled={isLoading || credits <= 0}
              className="ml-auto justify-center flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-bold px-4 sm:px-5 py-2.5 rounded-xl text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02] disabled:scale-100"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Ricerca...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Cerca</span>
                </>
              )}
            </button>
          </div>
        </form>

        <div className="border-t border-slate-100 bg-slate-50/50 px-4 sm:px-5 py-2 flex flex-wrap items-center gap-3 sm:gap-6">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium" title="Dati aggiornati e verificati in tempo reale">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Database verificato
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium" title="L'AI capisce cosa stai cercando anche con frasi complesse">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Ricerca intelligente
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium" title="Tutti i dati sono raccolti nel rispetto della normativa GDPR">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            GDPR Compliant
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
            <CreditCard className="w-3 h-3" />
            Costo: {Math.min(maxLeads, credits)} crediti ({Math.min(maxLeads, credits)} lead)
          </span>
          {isLoading && aiDebug ? (
            <span className="text-[11px] text-violet-600 font-medium">
              {(() => {
                const d = aiDebug as any
                const city = d?.city || '—'
                const cat = d?.category || '—'
                return `Cercando: ${cat} in ${city}...`
              })()}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium">⚠️ {error}</div>
      ) : null}
    </div>
  )
}

export default SniperArea
