'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Key, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/keys')
      .then((r) => r.json())
      .then((d) => {
        setKeys(d.data || [])
        setIsLoading(false)
      })
      .catch(() => {
        setKeys([])
        setIsLoading(false)
      })
  }, [])

  const createKey = async () => {
    if (!keyName.trim()) return
    setIsCreating(true)

    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName }),
      })

      const data = await res.json()
      setNewKey(data.key)
      setKeys((prev) => [
        ...prev,
        {
          key_prefix: data.prefix,
          name: data.name,
          is_active: true,
          requests_count: 0,
        },
      ])
      setKeyName('')
    } finally {
      setIsCreating(false)
    }
  }

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Key className="w-6 h-6 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-gray-500 text-sm">Integra CKB nel tuo workflow con la nostra API REST</p>
        </div>
      </div>

      {newKey ? (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-sm text-green-700 font-medium mb-2">⚠️ Copia questa chiave ora — non verrà mostrata di nuovo</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border rounded px-3 py-2 text-sm font-mono">{newKey}</code>
            <Button size="sm" onClick={copyKey} className="bg-green-600 hover:bg-green-700">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="bg-white border rounded-xl p-4 mb-6">
        <h2 className="font-medium mb-3">Crea nuova chiave</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Nome chiave (es. Integrazione CRM)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <Button
            onClick={createKey}
            disabled={isCreating || !keyName.trim()}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Crea
          </Button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="font-medium">Le tue chiavi</h2>
        </div>

        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nessuna chiave API. Creane una per iniziare.</div>
        ) : (
          <div className="divide-y">
            {keys.map((k, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{k.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{k.key_prefix}...</div>
                  <div className="text-xs text-gray-400">{k.requests_count} richieste</div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    k.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {k.is_active ? 'Attiva' : 'Disattivata'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 bg-gray-900 rounded-xl p-4 text-sm font-mono text-gray-300">
        <div className="text-gray-500 mb-2"># Esempio utilizzo API</div>
        <div>
          <span className="text-purple-400">curl</span> https://ckbassicurazione.it/api/v1/leads \
        </div>
        <div className="ml-4">-H <span className="text-green-400">"Authorization: Bearer mx_..."</span> \</div>
        <div className="ml-4">-G -d <span className="text-green-400">"categoria=agenzie seo"</span> \</div>
        <div className="ml-4">-d <span className="text-green-400">"citta=Milano"</span> \</div>
        <div className="ml-4">-d <span className="text-green-400">"no_pixel=true"</span></div>
      </div>
    </div>
  )
}
