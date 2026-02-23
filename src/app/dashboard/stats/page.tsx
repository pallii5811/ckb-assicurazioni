import { getConversionStats, getUserModel } from '../scoring/actions'
import { Brain, CheckCircle, Phone, TrendingUp, XCircle } from 'lucide-react'

export default async function StatsPage() {
  const [stats, model] = await Promise.all([getConversionStats(), getUserModel()])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Brain className="w-6 h-6 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Il Tuo Scoring AI</h1>
          <p className="text-gray-500 text-sm">Il modello impara dalle tue conversioni e migliora lo score nel tempo</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <Phone className="w-4 h-4" /> Contattati
          </div>
          <div className="text-2xl font-bold">{stats.total_contacted}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" /> Convertiti
          </div>
          <div className="text-2xl font-bold text-green-600">{stats.total_converted}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <XCircle className="w-4 h-4 text-red-500" /> Scartati
          </div>
          <div className="text-2xl font-bold text-red-500">{stats.total_rejected}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <TrendingUp className="w-4 h-4 text-purple-500" /> Tasso chiusura
          </div>
          <div className="text-2xl font-bold text-purple-600">{stats.conversion_rate}%</div>
        </div>
      </div>

      {model ? (
        <div className="bg-white border rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-600" />
            Pesi del tuo modello personale
          </h2>
          <div className="space-y-3">
            {[
              { label: 'Senza Facebook Pixel', value: model.weight_no_pixel },
              { label: 'Con Email', value: model.weight_has_email },
              { label: 'Errori SEO', value: model.weight_seo_errors },
              { label: 'Senza GTM', value: model.weight_no_gtm },
              { label: 'Sito Lento', value: model.weight_slow_speed },
              { label: 'Senza SSL', value: model.weight_no_ssl },
              { label: 'Senza Google Ads', value: model.weight_no_google_ads },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-40">{item.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${item.value}%` }} />
                </div>
                <span className="text-sm font-medium text-gray-700 w-8">{Math.round(item.value)}</span>
              </div>
            ))}
          </div>

          {model.last_trained_at ? (
            <p className="text-xs text-gray-400 mt-4">
              Ultimo aggiornamento: {new Date(model.last_trained_at).toLocaleDateString('it-IT')} {' · '} {model.total_conversions}{' '}
              conversioni {' · '} {model.total_rejections} scartati
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-4">
              Il modello si aggiornerà automaticamente dopo le prime 5 conversioni o rifiuti.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
