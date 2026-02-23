'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDashboard, PLAN_CREDITS, PLAN_LABELS } from '@/components/DashboardContext'
import { Check, Crown, Zap, Building2, Rocket } from 'lucide-react'

const plans = [
  {
    id: 'free' as const,
    name: 'Esplora',
    price: '€0',
    period: 'per sempre',
    icon: Zap,
    features: ['100 crediti una tantum', 'Ricerca base', 'Export CSV', 'Nessuna carta richiesta'],
    highlight: false,
  },
  {
    id: 'starter' as const,
    name: 'Starter',
    price: '€29',
    period: '/ mese',
    icon: Rocket,
    features: ['500 crediti / mese', 'Ricerca iper-localizzata', 'Cellulari verificati', 'Export CSV/Excel', 'Supporto email'],
    highlight: false,
    badge: '🔥 Popolare',
  },
  {
    id: 'pro' as const,
    name: 'PRO',
    price: '€99',
    period: '/ mese',
    icon: Crown,
    features: ['3.000 crediti / mese', 'Email decision maker', 'Pitch AI personalizzato', 'Freshness score', 'Priorità supporto'],
    highlight: true,
    badge: 'Più Scelto',
  },
  {
    id: 'agency' as const,
    name: 'Agency',
    price: '€249',
    period: '/ mese',
    icon: Building2,
    features: ['10.000 crediti / mese', 'Multi-utente (fino a 5)', 'API access', 'Webhook illimitati', 'Account manager dedicato'],
    highlight: false,
  },
]

export default function BillingPage() {
  const { credits, planType } = useDashboard()
  const planCredits = PLAN_CREDITS[planType] || 100
  const planLabel = PLAN_LABELS[planType] || 'Free'

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Syne, sans-serif' }}>
          Abbonamento e Billing
        </h1>
        <p className="text-sm text-slate-500 mt-1">Gestisci il tuo piano e i crediti mensili</p>
      </div>

      {/* Current plan summary */}
      <Card className="bg-gradient-to-r from-violet-600 to-blue-600 border-0 rounded-2xl p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm text-white/70 font-medium">Piano attuale</p>
            <p className="text-2xl font-bold mt-0.5">{planLabel}</p>
            <p className="text-sm text-white/70 mt-1">
              {credits.toLocaleString('it-IT')} crediti rimanenti su {planCredits.toLocaleString('it-IT')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-center min-w-[100px]">
              <p className="text-2xl font-bold">{credits.toLocaleString('it-IT')}</p>
              <p className="text-xs text-white/60">crediti</p>
            </div>
            {/* Progress ring */}
            <div className="relative w-16 h-16">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="white" strokeWidth="3"
                  strokeDasharray={`${Math.round((credits / planCredits) * 94)} 94`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                {Math.round((credits / planCredits) * 100)}%
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Plans grid */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Scegli il tuo piano</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === planType
            const Icon = plan.icon

            return (
              <Card
                key={plan.id}
                className={`relative rounded-2xl p-5 transition-all ${
                  plan.highlight
                    ? 'border-2 border-violet-400 bg-violet-50/50 shadow-lg shadow-violet-100'
                    : 'border border-slate-200 bg-white'
                } ${isCurrent ? 'ring-2 ring-violet-500 ring-offset-2' : ''}`}
              >
                {plan.badge && (
                  <span className={`absolute -top-3 left-4 text-xs font-bold px-3 py-1 rounded-full ${
                    plan.highlight
                      ? 'bg-violet-600 text-white'
                      : 'bg-amber-100 text-amber-700 border border-amber-200'
                  }`}>
                    {plan.badge}
                  </span>
                )}

                <div className="flex items-center gap-2 mb-3 mt-1">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    plan.highlight ? 'bg-violet-100' : 'bg-slate-100'
                  }`}>
                    <Icon className={`w-4 h-4 ${plan.highlight ? 'text-violet-600' : 'text-slate-600'}`} />
                  </div>
                  <h3 className="font-bold text-slate-900">{plan.name}</h3>
                </div>

                <div className="mb-4">
                  <span className="text-2xl font-bold text-slate-900">{plan.price}</span>
                  <span className="text-sm text-slate-500 ml-1">{plan.period}</span>
                </div>

                <ul className="space-y-2 mb-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-slate-600">
                      <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <Button disabled className="w-full rounded-xl bg-slate-100 text-slate-500 cursor-default">
                    Piano attuale
                  </Button>
                ) : (
                  <Button
                    className={`w-full rounded-xl ${
                      plan.highlight
                        ? 'bg-violet-600 hover:bg-violet-700 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                    onClick={() => {
                      // Stripe checkout will go here
                      alert('L\'integrazione Stripe sarà disponibile a breve. Contatta supporto@onlid.it per upgrade manuali.')
                    }}
                  >
                    {plan.price === '€0' ? 'Downgrade' : 'Upgrade'}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* FAQ */}
      <Card className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-bold text-slate-900 mb-4">Domande frequenti</h2>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold text-slate-800">Come funzionano i crediti?</p>
            <p className="text-slate-500 mt-0.5">Ogni lead trovato consuma 1 credito. Prima di cercare puoi scegliere quanti lead vuoi (10, 25, 50, 100). I crediti si rinnovano mensilmente e non si accumulano.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Posso cancellare in qualsiasi momento?</p>
            <p className="text-slate-500 mt-0.5">Sì, senza vincoli. La cancellazione ha effetto alla fine del periodo corrente. Garanzia 14 giorni soddisfatti o rimborsati.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Cosa succede se finisco i crediti?</p>
            <p className="text-slate-500 mt-0.5">Le ricerche verranno bloccate fino al rinnovo o all&apos;upgrade del piano. I lead già trovati restano accessibili.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
