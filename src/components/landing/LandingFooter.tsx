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
    <footer className="bg-slate-950 border-t border-white/5 pt-16 pb-8 px-6 sm:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-12 mb-14">
          {/* Brand */}
          <div>
            <div className="mb-5">
              <img src="/mirax-logo-white.svg" alt="MiraX" className="h-9 w-auto" />
            </div>
            <p className="text-sm text-white/35 font-['DM_Sans'] leading-relaxed max-w-[240px] mb-6">
              Il motore di intelligence B2B più potente d&apos;Italia.
              Trova, analizza e chiudi. In 2 minuti.
            </p>
            <div className="flex gap-2 flex-wrap">
              {['GDPR', 'EU Server', '99.9% uptime'].map((b) => (
                <span key={b} className="text-[11px] font-medium text-white/30 bg-white/5 border border-white/[0.08] rounded-full px-2.5 py-1 font-['DM_Sans']">
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([group, items]) => (
            <div key={group}>
              <div className="text-[11px] font-bold text-white/25 uppercase tracking-widest font-['DM_Sans'] mb-4">
                {group}
              </div>
              <div className="flex flex-col gap-2.5">
                {items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="text-sm text-white/40 hover:text-white/80 transition-colors font-['DM_Sans'] no-underline"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.06] mb-6" />

        {/* Bottom row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs text-white/20 font-['DM_Sans']">
            © {new Date().getFullYear()} MiraX. Tutti i diritti riservati.
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
            <span className="text-xs text-white/20 font-['DM_Sans']">
              Tutti i sistemi operativi
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}