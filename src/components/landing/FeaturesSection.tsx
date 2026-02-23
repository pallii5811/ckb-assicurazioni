'use client'

import {
  MapPinned,
  Smartphone,
  Mail,
  FileSpreadsheet,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

function CardMicroMockup({ title }: { title: string }) {
  if (title === 'Ricerca Iper-Localizzata') {
    return (
      <div className="mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-medium text-slate-700">
              Centri Sportivi • Milano
            </div>
            <div className="rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm transition-all duration-300 group-hover:shadow-[0_0_0_4px_rgba(124,58,237,0.18)] group-hover:brightness-110">
              Search
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
            <span>Radius</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium">
              5 km
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (title === 'Telefoni Cellulari Verificati') {
    return (
      <div className="mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-800">Number Type</div>
            <div className="text-[11px] text-slate-500">Verified</div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-[11px] font-medium text-slate-500 transition-colors duration-300 group-hover:text-slate-400">
              Landline
            </div>
            <div className="relative h-7 w-12 rounded-full bg-slate-200 p-1 transition-colors duration-300 group-hover:bg-emerald-400/90">
              <div className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 group-hover:translate-x-5" />
            </div>
            <div className="text-[11px] font-semibold text-slate-600 transition-colors duration-300 group-hover:text-emerald-700">
              Mobile
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Confidence</span>
            <span className="font-semibold text-slate-700 group-hover:text-emerald-700 transition-colors">
              98%
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (title === 'Export CSV/Excel Immediato') {
    return (
      <div className="mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-800">Export</div>
            <div className="text-[11px] text-slate-500">CSV</div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-medium text-slate-700">data_export_oggi.csv</div>
              <div className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors duration-300 group-hover:bg-emerald-600">
                Download
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-[18%] rounded-full bg-emerald-500 transition-all duration-300 group-hover:w-[88%]" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (title === 'Email dei Decision Maker') {
    return (
      <div className="mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-800">Contacts</div>
            <div className="text-[11px] text-slate-500">DM</div>
          </div>
          <div className="mt-3 space-y-2">
            {[
              { n: 'Marco B.', r: 'Founder', s: 'verified' },
              { n: 'Giulia R.', r: 'CEO', s: 'verified' },
              { n: 'Paolo C.', r: 'Head of Sales', s: 'found' },
            ].map((row) => (
              <div
                key={row.n}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div>
                  <div className="text-[12px] font-semibold text-slate-800">{row.n}</div>
                  <div className="text-[11px] text-slate-500">{row.r}</div>
                </div>
                <div
                  className={
                    row.s === 'verified'
                      ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
                      : 'rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700'
                  }
                >
                  {row.s === 'verified' ? 'Verified' : 'Found'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (title === 'Qualità & Compliance') {
    return (
      <div className="mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-800">Checks</div>
            <div className="text-[11px] text-slate-500">GDPR</div>
          </div>
          <div className="mt-3 space-y-2">
            {[
              { label: 'Deduplication', on: true },
              { label: 'Email validation', on: true },
              { label: 'Opt-out rules', on: true },
            ].map((i) => (
              <div key={i.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[12px] font-medium text-slate-700">{i.label}</div>
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] transition-transform duration-300 group-hover:scale-110" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (title === 'UX Enterprise') {
    return (
      <div className="mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-800">Workspace</div>
            <div className="text-[11px] text-slate-500">Team</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {['Leads', 'Lists', 'Signals', 'Exports'].map((t, idx) => (
              <div
                key={t}
                className={
                  idx === 2
                    ? 'rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] font-semibold text-violet-700 transition-all duration-300 group-hover:shadow-[0_0_0_4px_rgba(124,58,237,0.10)]'
                    : 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-700'
                }
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return null
}

const features = [
  {
    icon: MapPinned,
    title: 'Ricerca Iper-Localizzata',
    description: 'Città e categorie per colpire il mercato giusto con precisione chirurgica.',
  },
  {
    icon: Smartphone,
    title: 'Telefoni Cellulari Verificati',
    description: 'Algoritmo proprietario per distinguere mobile da fisso e ridurre sprechi di crediti.',
  },
  {
    icon: Mail,
    title: 'Email dei Decision Maker',
    description: 'Contatti utili, non generici: punta a CEO, Founder, Owner, Head of Sales.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Export CSV/Excel Immediato',
    description: 'Esporta e sincronizza il tuo workflow in pochi secondi.',
  },
  {
    icon: ShieldCheck,
    title: 'Qualità & Compliance',
    description: 'Filtri e verifiche per mantenere il tuo database pulito e affidabile.',
  },
  {
    icon: Sparkles,
    title: 'UX Enterprise',
    description: 'Layout pulito, veloce e pensato per team che lavorano su volumi.',
  },
]

export default function FeaturesSection() {
  return (
    <section id="features" className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Tutto quello che serve per generare pipeline
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Feature progettate per conversione, velocità, e qualità dei dati.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-4 gap-4">
          {features.map((f, idx) => {
            const spanCls =
              f.title === 'Ricerca Iper-Localizzata'
                ? 'md:col-span-2'
                : f.title === 'Export CSV/Excel Immediato'
                  ? 'md:col-span-2'
                  : 'md:col-span-1'

            const iconTone =
              f.title === 'Telefoni Cellulari Verificati'
                ? 'text-emerald-50 shadow-[0_0_0_6px_rgba(16,185,129,0.16)]'
                : f.title === 'Qualità & Compliance'
                  ? 'text-blue-50 shadow-[0_0_0_6px_rgba(59,130,246,0.16)]'
                  : 'text-violet-50 shadow-[0_0_0_6px_rgba(124,58,237,0.16)]'

            return (
              <div
                key={f.title}
                style={{ animationDelay: `${idx * 80}ms` }}
                className={`feature-card group relative rounded-3xl p-[1px] ${spanCls}`}
              >
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-violet-500/25 via-fuchsia-500/20 to-blue-500/20 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
                <div className="relative rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition-all duration-300 group-hover:border-transparent group-hover:shadow-lg overflow-hidden">
                  <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-violet-600/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shadow-sm ${iconTone}`}>
                    <f.icon className="h-6 w-6" />
                  </div>
                  <div className="mt-5 text-lg font-bold text-slate-900">{f.title}</div>
                  <div className="mt-2 text-slate-600 leading-relaxed">{f.description}</div>

                  <CardMicroMockup title={f.title} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          0% {
            opacity: 0;
            transform: translateY(10px);
          }
          100% {
            opacity: 1;
            transform: translateY(0px);
          }
        }
        .feature-card {
          animation: fadeInUp 520ms ease both;
        }
      `}</style>
    </section>
  )
}
