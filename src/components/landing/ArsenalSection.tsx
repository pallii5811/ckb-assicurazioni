
'use client'

import {
  Radar, Users, Smartphone, Star, Sparkles, RefreshCcw, ArrowRight,
} from 'lucide-react'
import CtaLink from '@/components/CtaLink'

const cards = [
  {
    icon: Radar,
    title: 'Radar X Tecnologico',
    desc: 'Vedi istantaneamente se usano Meta Pixel, Google Ads, GTM o se hanno un sito che fa scappare i visitatori. Conosci il loro dolore prima di chiamare.',
    tags: ['Meta Pixel', 'Google Ads', 'GTM', 'SSL', 'DMARC', 'SEO'],
    accent: '#6366F1', bg: '#EEF2FF',
    large: true,
  },
  {
    icon: Users,
    title: 'Cacciatore di Decision Maker',
    desc: "Identifichiamo titolari e contatti diretti nelle pagine 'Chi Siamo'. Bypassa i centralini. Parla con chi firma.",
    accent: '#0EA5E9', bg: '#F0F9FF',
    large: false,
  },
  {
    icon: Smartphone,
    title: 'Cellulari Verificati',
    desc: 'Il nostro algoritmo separa i cellulari dai fissi. Zero sprechi di crediti su numeri spenti o centralini.',
    accent: '#10B981', bg: '#F0FDF4',
    badge: 'PROPRIETARIO',
    badgeColor: '#10B981',
    large: false,
  },
  {
    icon: Sparkles,
    title: 'Pitch AI Personalizzato',
    desc: 'Un messaggio scritto su misura per ogni lead, basato sui suoi problemi specifici. Oggetto, corpo, e CTA. Copia e incolla. Manda. Chiudi.',
    accent: '#8B5CF6', bg: '#F5F3FF',
    badge: 'AI',
    badgeColor: '#8B5CF6',
    large: true,
    preview: '"Buongiorno Marco, ho analizzato il sito di [Azienda] e ho notato che manca il pixel di tracciamento..."',
  },
  {
    icon: Star,
    title: 'Analisi Reputazione',
    desc: 'Trova aziende con rating in calo. Sono le più facili da chiudere: sanno di avere un problema.',
    accent: '#F59E0B', bg: '#FFFBEB',
    large: false,
  },
  {
    icon: RefreshCcw,
    title: 'Freschezza Garantita',
    desc: 'Dati auto-aggiornati ogni 30 giorni. Zero lead obsoleti, zero tempo sprecato.',
    accent: '#EC4899', bg: '#FDF2F8',
    badge: 'NUOVO',
    badgeColor: '#EC4899',
    large: false,
  },
] as const

export default function ArsenalSection() {
  return (
    <section id="arsenal" style={{
      background: '#F8FAFC',
      padding: '96px 32px',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'white', border: '1px solid #E2E8F0',
            borderRadius: 999, padding: '6px 16px',
            fontSize: 11, fontWeight: 600,
            color: '#64748B', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 20,
            fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            L'Arsenale Completo
          </div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: '#0F172A', marginBottom: 16,
          }}>
            Tutto quello che serve{' '}
            <span style={{ color: '#6366F1' }}>per chiudere contratti</span>
          </h2>
          <p style={{
            fontSize: 17, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
            maxWidth: 480, margin: '0 auto',
          }}>
            Non cerchi contatti. Trovi aziende
            che hanno già bisogno di te.
          </p>
        </div>

        {/* Bento Grid */}
        <div style={{
          display: 'grid',
        }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {cards.map((card, i) => (
            <div
              key={card.title}
              style={{
                background: 'white',
                border: '1px solid #F1F5F9',
                borderRadius: 16,
                padding: '28px',
                position: 'relative',
                boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
                transition: 'all 0.2s ease',
              }}
              className={card.large ? 'col-span-1 lg:col-span-2' : ''}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 30px ${card.accent}18` 
                ;(e.currentTarget as HTMLDivElement).style.borderColor = `${card.accent}25` 
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 8px rgba(0,0,0,0.04)'
                ;(e.currentTarget as HTMLDivElement).style.borderColor = '#F1F5F9'
              }}
            >
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: card.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <card.icon size={20} color={card.accent} />
                </div>
                {'badge' in card && card.badge && (
                  <div style={{
                    fontSize: 9, fontWeight: 700,
                    padding: '4px 10px', borderRadius: 999,
                    background: `${card.badgeColor}15`,
                    color: card.badgeColor,
                    border: `1px solid ${card.badgeColor}30`,
                    fontFamily: 'DM Sans, sans-serif',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>
                    {card.badge}
                  </div>
                )}
              </div>

              {/* Title */}
              <div style={{
                fontSize: 16, fontWeight: 700,
                color: '#0F172A', marginBottom: 8,
                fontFamily: 'Syne, sans-serif',
              }}>
                {card.title}
              </div>

              {/* Desc */}
              <p style={{
                fontSize: 14, color: '#64748B',
                lineHeight: 1.65,
                fontFamily: 'DM Sans, sans-serif',
                margin: 0,
              }}>
                {card.desc}
              </p>

              {/* Tags */}
              {'tags' in card && card.tags && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                  {card.tags.map((tag: string) => (
                    <span key={tag} style={{
                      fontSize: 10, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 999,
                      background: '#EEF2FF', color: '#6366F1',
                      fontFamily: 'DM Sans, sans-serif',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Preview */}
              {'preview' in card && card.preview && (
                <div style={{
                  marginTop: 16, padding: '12px 14px',
                  background: '#F8FAFC', borderRadius: 10,
                  border: '1px solid #F1F5F9',
                }}>
                  <div style={{
                    fontSize: 10, color: '#94A3B8',
                    fontFamily: 'DM Sans, sans-serif',
                    marginBottom: 6, textTransform: 'uppercase',
                    letterSpacing: '0.06em', fontWeight: 600,
                  }}>
                    Esempio pitch generato:
                  </div>
                  <div style={{
                    fontSize: 12, color: '#475569',
                    fontFamily: 'DM Sans, sans-serif',
                    lineHeight: 1.6, fontStyle: 'italic',
                  }}>
                    {card.preview}
                  </div>
                </div>
              )}

            </div>
          ))}

          {/* CTA Card */}
          <div style={{
            background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
            borderRadius: 16, padding: '32px 36px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', flexWrap: 'wrap',
            gap: 20,
          }} className="col-span-1 md:col-span-2 lg:col-span-3">
            <div>
              <div style={{
                fontSize: 20, fontWeight: 700,
                color: 'white', marginBottom: 6,
                fontFamily: 'Syne, sans-serif',
              }}>
                Pronto a chiudere i tuoi prossimi clienti?
              </div>
              <div style={{
                fontSize: 14, color: 'rgba(255,255,255,0.7)',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                Unisciti a 200+ agency italiane che usano MIRAX ogni giorno.
              </div>
            </div>
            <CtaLink>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'white', color: '#6366F1',
                fontSize: 14, fontWeight: 700,
                padding: '12px 24px', borderRadius: 10,
                fontFamily: 'DM Sans, sans-serif',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              }}>
                Inizia Gratis
                <ArrowRight size={16} />
              </span>
            </CtaLink>
          </div>

        </div>
      </div>
    </section>
  )
}
