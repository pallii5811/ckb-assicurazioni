'use client'

import Link from 'next/link'
import MiraxLogo from '@/components/MiraxLogo'

const links = {
  Prodotto: [
    { label: 'Come funziona', href: '/#how-it-works' },
    { label: 'Funzionalità', href: '/#features' },
    { label: 'Prezzi', href: '/#pricing' },
    { label: 'Casi d\'uso', href: '/#use-cases' },
  ],
  Legale: [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Termini di Servizio', href: '/terms' },
    { label: 'Cookie Policy', href: '/cookie-policy' },
  ],
  Supporto: [
    { label: 'Contatti', href: 'mailto:supporto@mirax.it' },
    { label: 'Dashboard', href: '/dashboard' },
  ],
}

export default function LandingFooter() {
  return (
    <footer style={{
      background: '#0F172A',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '64px 32px 32px',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Top row */}
        <div style={{
          display: 'grid',
          marginBottom: 56,
        }} className="grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-12">

          {/* Brand */}
          <div>
            {/* Logo */}
           {/* Logo */}
           {/* Logo */}
            <div style={{ marginBottom: 16 }}>
              <img src="/mirax-logo-white.svg" alt="MiraX" style={{ height: 40, width: 'auto' }} />
            </div>

            <p style={{
              fontSize: 14, color: 'rgba(255,255,255,0.4)',
              fontFamily: 'DM Sans, sans-serif',
              lineHeight: 1.65, maxWidth: 240, marginBottom: 24,
            }}>
              Il motore di intelligence B2B più potente d'Italia.
              Trova, analizza e chiudi. In 2 minuti.
            </p>

            {/* Trust badges mini */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['🔒 GDPR', '🇪🇺 EU Server', '⚡ 99.9% uptime'].map((b) => (
                <span key={b} style={{
                  fontSize: 11, fontWeight: 500,
                  color: 'rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 999, padding: '4px 10px',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([group, items]) => (
            <div key={group}>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: 'rgba(255,255,255,0.3)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontFamily: 'DM Sans, sans-serif',
                marginBottom: 16,
              }}>
                {group}
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                {items.map((item) => (
                  <Link key={item.label} href={item.href} style={{
                    fontSize: 14, color: 'rgba(255,255,255,0.45)',
                    textDecoration: 'none',
                    fontFamily: 'DM Sans, sans-serif',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{
          height: 1,
          background: 'rgba(255,255,255,0.06)',
          marginBottom: 24,
        }} />

        {/* Bottom row */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <span style={{
            fontSize: 13, color: 'rgba(255,255,255,0.25)',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            © {new Date().getFullYear()} MiraX. Tutti i diritti riservati.
          </span>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#10B981', display: 'inline-block',
              boxShadow: '0 0 0 3px rgba(16,185,129,0.15)',
            }} />
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.25)',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              Tutti i sistemi operativi
            </span>
          </div>
        </div>

      </div>
    </footer>
  )
}