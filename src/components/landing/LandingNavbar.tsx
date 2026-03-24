'use client'

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import CtaLink from '@/components/CtaLink'
import MiraxLogo from '@/components/MiraxLogo'

const navItems = [
  { label: 'Come funziona', href: '#how-it-works' },
  { label: 'Funzionalità', href: '#arsenal' },
  { label: 'Prezzi', href: '#pricing' },
]

export default function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header className={`sticky top-0 z-50 bg-white/95 backdrop-blur-md transition-all duration-300 ${
      scrolled ? 'border-b border-slate-100 shadow-sm' : 'border-b border-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-6 sm:px-8 flex items-center justify-between h-[68px]">
        {/* Logo */}
        <Link href="/" className="no-underline">
          <MiraxLogo size={32} />
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors font-['DM_Sans'] no-underline"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:block text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors font-['DM_Sans'] no-underline px-4 py-2"
          >
            Accedi
          </Link>
          <span className="hidden sm:inline-block">
            <CtaLink>
              <span className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg font-['DM_Sans'] shadow-md shadow-indigo-500/25 cursor-pointer transition-all">
                Inizia Gratis
                <ArrowRight size={14} />
              </span>
            </CtaLink>
          </span>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 bg-transparent border-none cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2">
              {mobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="bg-white border-t border-slate-100 px-6 sm:px-8 py-4 flex flex-col gap-4">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="text-base font-medium text-slate-700 no-underline font-['DM_Sans'] pb-3 border-b border-slate-100"
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/login"
            className="text-base font-medium text-slate-700 no-underline font-['DM_Sans']"
          >
            Accedi
          </Link>
          <CtaLink>
            <span className="flex justify-center bg-indigo-600 text-white text-sm font-semibold py-3 px-5 rounded-lg font-['DM_Sans'] cursor-pointer">
              Inizia Gratis →
            </span>
          </CtaLink>
        </div>
      )}
    </header>
  )
}
