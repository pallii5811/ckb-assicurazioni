'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDashboard, PLAN_CREDITS, PLAN_LABELS } from '@/components/DashboardContext'
import { Check, Crown, Zap, Building2, Rocket, CreditCard, Loader2, ExternalLink, Shield } from 'lucide-react'

type PaymentMethod = 'stripe' | 'paypal'

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
    badge: 'Popolare',
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
  const searchParams = useSearchParams()

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Handle return from Stripe/PayPal
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setSuccessMsg('Pagamento completato! Il tuo piano è stato aggiornato.')
    } else if (searchParams.get('canceled') === 'true') {
      setErrorMsg('Pagamento annullato.')
    }

    // Handle PayPal return — capture the order
    const paypalStatus = searchParams.get('paypal')
    const token = searchParams.get('token') // PayPal order ID
    if (paypalStatus === 'success' && token) {
      capturePayPalOrder(token)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function capturePayPalOrder(orderId: string) {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccessMsg(`Pagamento PayPal completato! Piano aggiornato a ${data.plan}.`)
        window.history.replaceState({}, '', '/dashboard/billing')
      } else {
        setErrorMsg(data.error || 'Errore durante la cattura del pagamento PayPal.')
      }
    } catch {
      setErrorMsg('Errore di rete durante la conferma del pagamento PayPal.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpgrade(planId: string) {
    if (planId === 'free') return
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      if (paymentMethod === 'stripe') {
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        })
        const data = await res.json()
        if (data.url) {
          window.location.href = data.url
          return
        }
        setErrorMsg(data.error || 'Errore creazione checkout Stripe.')
      } else {
        const res = await fetch('/api/paypal/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        })
        const data = await res.json()
        if (data.approvalUrl) {
          window.location.href = data.approvalUrl
          return
        }
        setErrorMsg(data.error || 'Errore creazione ordine PayPal.')
      }
    } catch {
      setErrorMsg('Errore di rete. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManageSubscription() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setErrorMsg(data.error || 'Impossibile aprire il portale di gestione.')
      }
    } catch {
      setErrorMsg('Errore di rete.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Syne, sans-serif' }}>
          Abbonamento e Billing
        </h1>
        <p className="text-sm text-slate-500 mt-1">Gestisci il tuo piano e i crediti mensili</p>
      </div>

      {/* Success / Error banners */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2">
          <Check className="w-4 h-4" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm font-medium">
          {errorMsg}
        </div>
      )}

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
            {planType !== 'free' && (
              <Button
                onClick={handleManageSubscription}
                disabled={loading}
                className="bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-xl text-xs px-3 py-2"
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Gestisci
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Payment method selector */}
      <Card className="bg-white border border-slate-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Metodo di pagamento</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setPaymentMethod('stripe')}
            className={`flex-1 flex items-center justify-center gap-3 rounded-xl border-2 px-4 py-3 transition-all ${
              paymentMethod === 'stripe'
                ? 'border-violet-500 bg-violet-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <CreditCard className={`w-5 h-5 ${paymentMethod === 'stripe' ? 'text-violet-600' : 'text-slate-400'}`} />
            <div className="text-left">
              <p className={`text-sm font-semibold ${paymentMethod === 'stripe' ? 'text-violet-700' : 'text-slate-700'}`}>
                Carta di Credito / Debito
              </p>
              <p className="text-xs text-slate-400">Visa, Mastercard, Amex via Stripe</p>
            </div>
            {paymentMethod === 'stripe' && (
              <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center ml-auto">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </button>

          <button
            onClick={() => setPaymentMethod('paypal')}
            className={`flex-1 flex items-center justify-center gap-3 rounded-xl border-2 px-4 py-3 transition-all ${
              paymentMethod === 'paypal'
                ? 'border-blue-500 bg-blue-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <svg className={`w-5 h-5 ${paymentMethod === 'paypal' ? 'text-blue-600' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c1.482-1.835 1.014-4.355-.508-5.843C18.75-.675 16.447 0 14.076 0h-.003c.003 0 .005.001.007.002-.002 0-.004-.002-.007-.002H6.654c-.528 0-.973.382-1.055.9L2.51 20.597a.643.643 0 0 0 .635.74h4.122l-.135.863a.572.572 0 0 0 .566.66h3.942c.46 0 .853-.335.925-.79l.038-.19.733-4.648.047-.256a.93.93 0 0 1 .919-.79h.578c3.762 0 6.706-1.528 7.565-5.946.36-1.847.174-3.388-.744-4.473z"/>
            </svg>
            <div className="text-left">
              <p className={`text-sm font-semibold ${paymentMethod === 'paypal' ? 'text-blue-700' : 'text-slate-700'}`}>
                PayPal
              </p>
              <p className="text-xs text-slate-400">Paga con il tuo account PayPal</p>
            </div>
            {paymentMethod === 'paypal' && (
              <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center ml-auto">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </button>
        </div>
      </Card>

      {/* Plans grid */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Scegli il tuo piano</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === planType
            const Icon = plan.icon
            const isSelected = selectedPlan === plan.id

            return (
              <Card
                key={plan.id}
                className={`relative rounded-2xl p-5 transition-all cursor-pointer ${
                  plan.highlight
                    ? 'border-2 border-violet-400 bg-violet-50/50 shadow-lg shadow-violet-100'
                    : 'border border-slate-200 bg-white'
                } ${isCurrent ? 'ring-2 ring-violet-500 ring-offset-2' : ''}
                ${isSelected && !isCurrent ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}
                onClick={() => !isCurrent && plan.id !== 'free' && setSelectedPlan(plan.id)}
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
                ) : plan.id === 'free' ? (
                  <Button disabled className="w-full rounded-xl bg-slate-50 text-slate-400 cursor-default">
                    Gratuito
                  </Button>
                ) : (
                  <Button
                    className={`w-full rounded-xl ${
                      plan.highlight
                        ? 'bg-violet-600 hover:bg-violet-700 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                    disabled={loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleUpgrade(plan.id)
                    }}
                  >
                    {loading && selectedPlan === plan.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    {paymentMethod === 'stripe' ? 'Paga con Carta' : 'Paga con PayPal'}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* Security badge */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-2">
        <Shield className="w-4 h-4" />
        <span>Pagamenti sicuri e criptati. Garanzia 14 giorni soddisfatti o rimborsati.</span>
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
          <div>
            <p className="font-semibold text-slate-800">Quali metodi di pagamento accettate?</p>
            <p className="text-slate-500 mt-0.5">Accettiamo tutte le principali carte di credito/debito (Visa, Mastercard, American Express) tramite Stripe e PayPal.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Come gestisco il mio abbonamento?</p>
            <p className="text-slate-500 mt-0.5">Puoi gestire, cambiare piano o cancellare il tuo abbonamento in qualsiasi momento da questa pagina cliccando su &quot;Gestisci&quot;.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
