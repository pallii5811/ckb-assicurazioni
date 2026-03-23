'use client'

import { useState } from 'react'
import { ShieldCheck, Plus, Minus } from 'lucide-react'

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
    <section style={{
      background: '#F8FAFC',
      padding: '96px 32px',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 20,
          marginBottom: 48,
        }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              background: 'white', border: '1px solid #E2E8F0',
              borderRadius: 999, padding: '6px 16px',
              fontSize: 11, fontWeight: 600,
              color: '#64748B', letterSpacing: '0.08em',
              textTransform: 'uppercase', marginBottom: 16,
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              FAQ
            </div>
            <h2 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)',
              fontWeight: 600,
              letterSpacing: '-0.025em',
              color: '#0F172A', marginBottom: 8,
            }}>
              Domande Frequenti
            </h2>
            <p style={{
              fontSize: 16, color: '#64748B',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              Risposte chiare su dati, qualità e crediti.
            </p>
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#F0FDF4', border: '1px solid #BBF7D0',
            borderRadius: 10, padding: '10px 16px',
            alignSelf: 'flex-start',
          }}>
            <ShieldCheck size={16} color="#10B981" />
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: '#166534',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              100% GDPR Compliant
            </span>
          </div>
        </div>

        {/* FAQ grid */}
        <div style={{
          display: 'grid',
        }} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {faqs.map((item, i) => (
            <div key={item.q} style={{
              background: 'white',
              border: open === i ? '1px solid #C7D2FE' : '1px solid #F1F5F9',
              borderRadius: 14,
              overflow: 'hidden',
              transition: 'all 0.2s',
              boxShadow: open === i ? '0 4px 16px rgba(99,102,241,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12,
                  padding: '18px 20px',
                  background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: 14, fontWeight: 600,
                  color: '#0F172A',
                  fontFamily: 'DM Sans, sans-serif',
                  lineHeight: 1.4,
                }}>
                  {item.q}
                </span>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: open === i ? '#EEF2FF' : '#F8FAFC',
                  border: '1px solid',
                  borderColor: open === i ? '#C7D2FE' : '#E2E8F0',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                  transition: 'all 0.2s',
                }}>
                  {open === i
                    ? <Minus size={12} color="#6366F1" />
                    : <Plus size={12} color="#64748B" />
                  }
                </div>
              </button>
              <div style={{
                maxHeight: open === i ? 300 : 0,
                overflow: 'hidden',
                transition: 'max-height 0.3s ease',
              }}>
                <p style={{
                  padding: '0 20px 18px',
                  fontSize: 14, color: '#64748B',
                  lineHeight: 1.7,
                  fontFamily: 'DM Sans, sans-serif',
                  margin: 0,
                }}>
                  {item.a}
                </p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
