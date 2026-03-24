'use client'

import { useState } from 'react'
import { ShieldCheck, Plus, Minus, MessageCircle } from 'lucide-react'
import { motion } from 'framer-motion'

const faqs = [
  {
    q: 'Da dove provengono i dati?',
    a: 'I dati provengono da directory pubbliche italiane, siti aziendali e fonti verificate, aggregati e arricchiti dal nostro motore di intelligence proprietario in tempo reale. Nessun dato acquistato da terze parti.',
  },
  {
    q: 'I numeri di telefono sono reali?',
    a: 'Sì. Il nostro algoritmo scarta i numeri non validi, identifica i centralini e ti fornisce i cellulari aziendali verificati dove disponibili.',
  },
  {
    q: 'Come funzionano i crediti?',
    a: 'Un credito equivale a un lead estratto con successo (che contenga almeno telefono o email). Le ricerche a vuoto non consumano crediti.',
  },
  {
    q: "Posso cancellare l'abbonamento?",
    a: 'Assolutamente sì. Nessun vincolo, puoi disdire in qualsiasi momento con un click dalla tua dashboard.',
  },
  {
    q: 'I dati sono aggiornati?',
    a: "Sì. Il nostro sistema re-audita automaticamente ogni lead ogni 30 giorni. Ogni risultato mostra il 'Freshness Score' — sai esattamente quanto sono freschi i dati che stai usando.",
  },
  {
    q: 'Come funziona il Pitch AI?',
    a: "Analizziamo i problemi specifici dell'azienda (pixel mancante, errori SEO, sito lento) e generiamo un messaggio personalizzato con oggetto, corpo e call-to-action. Non è un template — è un messaggio scritto per quella specifica azienda.",
  },
  {
    q: 'Funziona per qualsiasi settore?',
    a: 'Funziona per qualsiasi categoria di attività locale: ristoranti, dentisti, avvocati, hotel, negozi, agenzie immobiliari, artigiani. Se è sul web italiano, lo troviamo e lo profiliamo.',
  },
  {
    q: 'Posso integrare i dati nel mio CRM?',
    a: 'Esportiamo in CSV/Excel compatibile con HubSpot, Pipedrive, Notion, e qualsiasi tool che accetta fogli di calcolo. Webhook e integrazione Zapier sono in arrivo nel piano Agency.',
  },
] as const

export default function FaqComplianceSection() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="py-24 lg:py-32 bg-slate-50 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-50/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <motion.div
          className="flex flex-wrap items-start justify-between gap-5 mb-12"
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div>
            <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 mb-5 shadow-sm">
              <MessageCircle size={12} className="text-indigo-500" />
              <span className="text-xs font-semibold text-slate-600 font-['DM_Sans'] uppercase tracking-wider">FAQ</span>
            </div>
            <h2 className="font-['Syne'] text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-2">
              Domande Frequenti
            </h2>
            <p className="text-base text-slate-500 font-['DM_Sans']">
              Risposte chiare su dati, qualità e crediti.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5">
            <ShieldCheck size={16} className="text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-800 font-['DM_Sans']">
              100% GDPR Compliant
            </span>
          </div>
        </motion.div>

        {/* FAQ grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {faqs.map((item, i) => (
            <motion.div
              key={item.q}
              className={`bg-white rounded-xl overflow-hidden transition-all duration-200 ${
                open === i
                  ? 'border border-indigo-200 shadow-md shadow-indigo-50'
                  : 'border border-slate-100 shadow-sm'
              }`}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04, duration: 0.4 }}
            >
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 p-5 text-left cursor-pointer bg-transparent border-none"
              >
                <span className="text-sm font-semibold text-slate-900 font-['DM_Sans'] leading-snug">
                  {item.q}
                </span>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  open === i
                    ? 'bg-indigo-50 border border-indigo-200'
                    : 'bg-slate-50 border border-slate-200'
                }`}>
                  {open === i
                    ? <Minus size={12} className="text-indigo-600" />
                    : <Plus size={12} className="text-slate-500" />
                  }
                </div>
              </button>
              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{ maxHeight: open === i ? 300 : 0 }}
              >
                <p className="px-5 pb-5 text-sm text-slate-500 font-['DM_Sans'] leading-relaxed m-0">
                  {item.a}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
