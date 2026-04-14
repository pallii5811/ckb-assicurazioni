"use client"

import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Cable,
  Check,
  Copy,
  Mail,
  Settings2,
  Workflow,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

type IntegrationId = 'webhook'

type Integration = {
  id: IntegrationId
  title: string
  description: string
  badge?: { label: string; tone: 'popular' | 'comingSoon' }
  icon: React.ReactNode
  enabled: boolean
  comingSoon?: boolean
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      aria-pressed={checked}
      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 focus-visible:ring-offset-0 ${
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : checked
            ? 'bg-violet-500/30 border-violet-400/40'
            : 'bg-slate-950/40 border-white/10 hover:border-violet-400/30'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white/90 shadow transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function Badge({ label, tone }: { label: string; tone: 'popular' | 'comingSoon' }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide'
  if (tone === 'popular') {
    return <span className={`${base} bg-violet-500/15 text-violet-200 border border-violet-400/20`}>{label}</span>
  }
  return <span className={`${base} bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-400/25`}>{label}</span>
}

function IntegrationCard({
  integration,
  onToggle,
  children,
}: {
  integration: Integration
  onToggle: (id: IntegrationId) => void
  children?: React.ReactNode
}) {
  return (
    <Card
      className={`group relative overflow-hidden rounded-3xl border border-violet-500/20 bg-slate-900/50 p-6 shadow-[0_20px_70px_-40px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-all duration-200 hover:border-[#A855F7] hover:shadow-[0_20px_70px_-30px_rgba(168,85,247,0.35)] ${
        integration.comingSoon ? 'opacity-80' : ''
      }`}
    >
      <div className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/10 border border-white/10">
            <div className="text-violet-200">{integration.icon}</div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-base font-bold text-white">{integration.title}</div>
              {integration.badge ? <Badge label={integration.badge.label} tone={integration.badge.tone} /> : null}
            </div>
            <div className="mt-0.5 text-sm text-white/65">{integration.description}</div>
          </div>
        </div>

        <Switch
          checked={integration.enabled}
          disabled={integration.comingSoon}
          onChange={() => onToggle(integration.id)}
        />
      </div>

      {children ? <div className="relative mt-5">{children}</div> : null}
    </Card>
  )
}

export default function IntegrationsPage() {
  const [webhookEnabled, setWebhookEnabled] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookError, setWebhookError] = useState<string | null>(null)
  const [webhookSaved, setWebhookSaved] = useState(false)

  useEffect(() => {
    const run = async () => {
      setWebhookLoading(true)
      setWebhookError(null)

      try {
        const res = await fetch('/api/integrations/webhook', { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { webhookUrl?: string; error?: string } | null

        if (!res.ok) {
          throw new Error(data?.error || 'Impossibile caricare le impostazioni webhook.')
        }

        const url = (data?.webhookUrl ?? '').trim()
        setWebhookUrl(url)
        setWebhookEnabled(Boolean(url))
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Errore webhook.'
        setWebhookError(raw)
      } finally {
        setWebhookLoading(false)
      }
    }

    run()
  }, [])

  const grid: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05,
      },
    },
  }

  const item: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Integrazioni</div>
        <div className="mt-1 text-sm text-slate-600">
          Collega CKB al tuo ecosistema di vendita. Attiva automazioni, CRM e alert in pochi secondi.
        </div>
      </div>

      <Card className="rounded-3xl border border-violet-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900">CRM Sync (HubSpot / Webhook)</div>
            <div className="mt-1 text-sm text-slate-600">Configura l'invio dei lead al tuo CRM e usa il bottone “CRM” nella tabella risultati.</div>
          </div>
          <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
            <Link href="/dashboard/integrations/crm">Configura</Link>
          </Button>
        </div>
      </Card>

      <motion.div
        variants={grid}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        <motion.div variants={item} className="lg:col-span-3">
          <IntegrationCard
            integration={{
              id: 'webhook',
              title: 'Webhook Personalizzato',
              description: 'Invia i dati grezzi (Audit, Email, Tech Stack) a qualsiasi endpoint esterno.',
              icon: <Cable className="h-5 w-5" />,
              enabled: webhookEnabled,
            }}
            onToggle={() => {
              setWebhookSaved(false)
              setWebhookError(null)
              setWebhookEnabled((p) => !p)
            }}
          >
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Mail className="h-4 w-4" />
                  Endpoint URL
                </div>
                <div className="text-xs text-white/55">POST JSON</div>
              </div>

              <div className="mt-3 flex flex-col md:flex-row gap-3">
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://tuo-endpoint.com/webhook"
                  className="h-12 rounded-2xl border-white/10 bg-slate-950/40 text-white placeholder:text-white/30"
                  disabled={webhookLoading || webhookSaving}
                />
                <Button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(webhookUrl)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1000)
                    } catch {
                      // ignore
                    }
                  }}
                  variant="secondary"
                  className="h-12 rounded-2xl border border-white/10 bg-white/5 text-white hover:bg-white/10"
                  disabled={!webhookUrl || webhookLoading || webhookSaving}
                >
                  {copied ? (
                    <span className="flex items-center gap-2">
                      <Check className="h-4 w-4" /> Copiato
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Copy className="h-4 w-4" /> Copia
                    </span>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    setWebhookSaving(true)
                    setWebhookError(null)
                    setWebhookSaved(false)

                    try {
                      const res = await fetch('/api/integrations/webhook', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ webhookUrl: webhookEnabled ? webhookUrl : '' }),
                      })

                      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null

                      if (!res.ok) {
                        throw new Error(data?.error || 'Errore durante il salvataggio.')
                      }

                      setWebhookSaved(true)
                      if (!webhookEnabled) {
                        setWebhookUrl('')
                      }
                    } catch (e) {
                      const raw = e instanceof Error ? e.message : 'Errore webhook.'
                      setWebhookError(raw)
                    } finally {
                      setWebhookSaving(false)
                    }
                  }}
                  className="h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-700 hover:to-blue-700"
                  disabled={webhookLoading || webhookSaving || (webhookEnabled && !webhookUrl)}
                >
                  {webhookSaving ? 'Salvataggio…' : 'Salva'}
                </Button>
              </div>

              <div className="mt-3 text-xs text-white/55">
                Quando attivo, CKB invierà payload con dati aziendali, contatti e segnali assicurativi. Perfetto per CRM custom,
                enrichment, orchestrazione e qualsiasi stack.
              </div>

              {webhookError ? (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {webhookError}
                </div>
              ) : null}

              {webhookSaved ? (
                <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  Webhook salvato.
                </div>
              ) : null}

              <div className="mt-3 text-xs text-white/45">
                Stato: {webhookEnabled ? 'Attivo' : 'Disattivato'}
              </div>
            </div>
          </IntegrationCard>
        </motion.div>
      </motion.div>
    </div>
  )
}
