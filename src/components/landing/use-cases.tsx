
'use client'

import { Search, Palette, BarChart3, Share2, Building2, MessageSquare } from 'lucide-react'

const useCases = [
  {
    icon: Search,
    title: 'SEO Specialist',
    problem: 'Ore perse a cercare aziende senza SEO',
    solution: 'Filtri "senza meta description" o "senza H1" → lista istantanea',
    result: '+€4.200/mese',
    accent: '#6366F1',
    bg: '#EEF2FF',
  },
  {
    icon: Palette,
    title: 'Web Designer',
    problem: 'Clienti con siti vecchi ma come trovarli?',
    solution: 'Filtro "sito lento" + "no mobile friendly" → restyling assicurati',
    result: '+€5.800/mese',
    accent: '#8B5CF6',
    bg: '#F5F3FF',
  },
  {
    icon: BarChart3,
    title: 'Ads Manager',
    problem: 'Chiami aziende che già fanno ads con altri',
    solution: 'Filtro "no Google Ads" + "no Meta Pixel" → campo libero',
    result: '+€6.500/mese',
    accent: '#0EA5E9',
    bg: '#F0F9FF',
  },
  {
    icon: Share2,
    title: 'Social Media Manager',
    problem: 'Difficile trovare chi non ha presenza social',
    solution: 'Vedi Instagram/Facebook di ogni lead → proposta mirata',
    result: '+€2.800/mese',
    accent: '#EC4899',
    bg: '#FDF2F8',
  },
  {
    icon: Building2,
    title: 'Agenzia Marketing',
    problem: 'Pipeline vuota, dipendenza da referral',
    solution: 'Ricerche illimitate + 5 utenti → flusso costante',
    result: '+€18.000/mese',
    accent: '#10B981',
    bg: '#F0FDF4',
  },
  {
    icon: MessageSquare,
    title: 'Consulente Digitale',
    problem: 'Arrivi impreparato alle call',
    solution: 'Audit completo + pitch AI → sai tutto prima di chiamare',
    result: '+€3.900/mese',
    accent: '#F59E0B',
    bg: '#FFFBEB',
  },
] as const

export function UseCases() {
  return (
    <section style={{
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
            Casi d'Uso
          </div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: '#0F172A',
            marginBottom: 16,
          }}>
            Costruito per chi{' '}
            <span style={{ color: '#6366F1' }}>chiude contratti</span>
          </h2>
          <p style={{
            fontSize: 17, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
            maxWidth: 480, margin: '0 auto',
            lineHeight: 1.65,
          }}>
            Che tu sia freelance o agenzia,
            MIRAX si adatta al tuo workflow
          </p>
        </div>

        {/* Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
        }} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((u) => (
            <div key={u.title} style={{
              background: 'white',
              border: '1px solid #F1F5F9',
              borderRadius: 16,
              padding: '28px 24px',
              position: 'relative',
              boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
              transition: 'all 0.2s ease',
              cursor: 'default',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 30px ${u.accent}20` 
              ;(e.currentTarget as HTMLDivElement).style.borderColor = `${u.accent}30` 
              ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 8px rgba(0,0,0,0.04)'
              ;(e.currentTarget as HTMLDivElement).style.borderColor = '#F1F5F9'
              ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
            }}
            >
              {/* Result badge */}
              <div style={{
                position: 'absolute', top: 20, right: 20,
                fontSize: 11, fontWeight: 700,
                padding: '4px 10px', borderRadius: 999,
                background: '#F0FDF4',
                color: '#10B981',
                fontFamily: 'DM Sans, sans-serif',
                border: '1px solid #BBF7D0',
              }}>
                {u.result}
              </div>

              {/* Icon */}
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: u.bg,
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', marginBottom: 16,
              }}>
                <u.icon size={20} color={u.accent} />
              </div>

              {/* Title */}
              <div style={{
                fontSize: 16, fontWeight: 700,
                color: '#0F172A', marginBottom: 8,
                fontFamily: 'Syne, sans-serif',
              }}>
                {u.title}
              </div>

              {/* Problem */}
              <div style={{
                fontSize: 13, color: '#94A3B8',
                textDecoration: 'line-through',
                marginBottom: 8,
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {u.problem}
              </div>

              {/* Solution */}
              <div style={{
                fontSize: 14, color: '#475569',
                lineHeight: 1.6,
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {u.solution}
              </div>

              {/* Bottom accent line */}
              <div style={{
                position: 'absolute', bottom: 0,
                left: 0, right: 0, height: 3,
                background: u.accent,
                borderRadius: '0 0 16px 16px',
                opacity: 0,
                transition: 'opacity 0.2s',
              }} className="card-accent-line" />
            </div>
          ))}
        </div>

        {/* CTA bottom */}
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <p style={{
            fontSize: 14, color: '#94A3B8',
            fontFamily: 'DM Sans, sans-serif', marginBottom: 12,
          }}>
            Non trovi il tuo caso d'uso?
          </p>
          <a href="/auth" style={{
            fontSize: 14, fontWeight: 600,
            color: '#6366F1', textDecoration: 'none',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            MIRAX funziona per qualsiasi settore → Prova gratis
          </a>
        </div>

      </div>
    </section>
  )
}
