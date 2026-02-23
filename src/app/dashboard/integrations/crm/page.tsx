'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, ExternalLink, Loader2, Plus, Plug, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/utils/supabase/client'

export default function CrmIntegrationsPage() {
  const supabase = createClient()

  const [integrations, setIntegrations] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [showHubspotForm, setShowHubspotForm] = useState(false)
  const [showWebhookForm, setShowWebhookForm] = useState(false)

  const [hubspotToken, setHubspotToken] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')

  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadIntegrations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadIntegrations = async () => {
    setIsLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIntegrations([])
      setIsLoading(false)
      return
    }

    const { data } = await supabase
      .from('crm_integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)

    setIntegrations(data || [])
    setIsLoading(false)
  }

  const saveHubspot = async () => {
    if (!hubspotToken.trim()) return

    setIsSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsSaving(false)
      return
    }

    await supabase.from('crm_integrations').insert({
      user_id: user.id,
      type: 'hubspot',
      name: 'HubSpot',
      config: { access_token: hubspotToken.trim() },
    })

    setHubspotToken('')
    setShowHubspotForm(false)
    setIsSaving(false)
    loadIntegrations()
  }

  const saveWebhook = async () => {
    if (!webhookUrl.trim()) return

    setIsSaving(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsSaving(false)
      return
    }

    await supabase.from('crm_integrations').insert({
      user_id: user.id,
      type: 'webhook',
      name: 'Webhook',
      config: { url: webhookUrl.trim(), secret: webhookSecret.trim() || null },
    })

    setWebhookUrl('')
    setWebhookSecret('')
    setShowWebhookForm(false)
    setIsSaving(false)
    loadIntegrations()
  }

  const hasHubspot = integrations.some((i) => i.type === 'hubspot')
  const hasWebhook = integrations.some((i) => i.type === 'webhook')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Plug className="w-6 h-6 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold">Integrazioni CRM</h1>
          <p className="text-gray-500 text-sm">Invia i lead direttamente nel tuo CRM con un click</p>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <span className="text-orange-600 font-bold text-sm">HS</span>
                </div>
                <div>
                  <h3 className="font-semibold">HubSpot</h3>
                  <p className="text-xs text-gray-500">CRM gratuito più usato in Italia</p>
                </div>
              </div>

              {hasHubspot ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Connesso
                </div>
              ) : showHubspotForm ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="HubSpot Private App Token"
                    value={hubspotToken}
                    onChange={(e) => setHubspotToken(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <a
                    href="https://developers.hubspot.com/docs/api/private-apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-purple-600 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Come ottenere il token
                  </a>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowHubspotForm(false)}>
                      Annulla
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveHubspot}
                      disabled={isSaving}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Collega'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setShowHubspotForm(true)}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Plus className="w-3 h-3 mr-1" /> Collega HubSpot
                </Button>
              )}
            </div>

            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Webhook className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold">Webhook</h3>
                  <p className="text-xs text-gray-500">Qualsiasi CRM (Pipedrive, Salesforce...)</p>
                </div>
              </div>

              {hasWebhook ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Connesso
                </div>
              ) : showWebhookForm ? (
                <div className="space-y-2">
                  <input
                    type="url"
                    placeholder="https://tuocrm.com/webhook"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <input
                    type="text"
                    placeholder="Secret (opzionale)"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowWebhookForm(false)}>
                      Annulla
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveWebhook}
                      disabled={isSaving}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Salva'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setShowWebhookForm(true)}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <Plus className="w-3 h-3 mr-1" /> Configura Webhook
                </Button>
              )}
            </div>
          </div>

          {integrations.length > 0 ? (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="p-4 border-b bg-gray-50 font-medium">Integrazioni attive</div>
              <div className="divide-y">
                {integrations.map((i) => (
                  <div key={i.id} className="p-4 flex justify-between items-center">
                    <div>
                      <div className="font-medium text-sm">{i.name}</div>
                      <div className="text-xs text-gray-400">
                        {i.leads_synced} lead sincronizzati
                        {i.last_sync_at ? ` · Ultimo: ${new Date(i.last_sync_at).toLocaleDateString('it-IT')}` : ''}
                      </div>
                    </div>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
