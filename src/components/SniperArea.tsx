'use client'

import { Sparkles, CreditCard, Search } from 'lucide-react'

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
    <div className="relative mb-4">
      {/* Glow */}
      <div className="pointer-events-none absolute -inset-4 rounded-[32px] bg-gradient-to-r from-violet-400/10 via-purple-400/10 to-blue-400/10 blur-3xl" />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onStart()
        }}
        className="relative"
      >
        <div className="flex items-center gap-3 bg-white rounded-full border border-slate-200 shadow-xl shadow-slate-200/40 px-5 sm:px-6 py-1 focus-within:border-violet-400 focus-within:shadow-violet-200/30 transition-all duration-300">
          <Search className="w-5 h-5 text-violet-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Cerca aziende... es. Imprese edili a Milano SRL"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="flex-1 bg-transparent text-[16px] sm:text-[18px] text-slate-900 placeholder:text-slate-400 outline-none py-4 sm:py-[18px] min-w-0 font-medium tracking-[-0.01em]"
          />

          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={maxLeads}
              onChange={(e) => onMaxLeadsChange(Number(e.target.value))}
              disabled={isLoading}
              className="bg-slate-50 border border-slate-200 rounded-full text-[11px] font-semibold text-slate-600 pl-2.5 pr-6 py-1.5 outline-none focus:border-violet-400 cursor-pointer disabled:opacity-50 hidden sm:block"
            >
              {LEAD_OPTIONS.map((n) => (
                <option key={n} value={n} disabled={n > credits}>
                  {n} lead{n > credits ? ` (${n} cr.)` : ''}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={isLoading || credits <= 0}
              className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-bold px-5 sm:px-7 py-2.5 sm:py-3 rounded-full text-sm shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-all duration-200 hover:scale-[1.03] disabled:scale-100"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span className="hidden sm:inline">Ricerca...</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  <span>Cerca</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Info row below search */}
      <div className="flex items-center justify-between px-6 mt-2">
        <div className="flex items-center gap-4">
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Database verificato
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Ricerca AI
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            GDPR
          </span>
        </div>
        <span className="text-[11px] font-semibold text-slate-400">
          {Math.min(maxLeads, credits)} crediti
        </span>
      </div>

      {isLoading && aiDebug ? (
        <p className="text-[11px] text-violet-600 font-medium animate-pulse text-center mt-1">
          {(() => {
            const d = aiDebug as any
            return `Cercando: ${d?.category || '—'} in ${d?.city || '—'}...`
          })()}
        </p>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium">{error}</div>
      ) : null}
    </div>
  )
}

export default SniperArea
