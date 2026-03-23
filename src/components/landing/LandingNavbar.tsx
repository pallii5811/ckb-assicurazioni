
'use client'

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import CtaLink from '@/components/CtaLink'
import MiraxLogo from '@/components/MiraxLogo'

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
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'white',
      borderBottom: scrolled ? '1px solid #F1F5F9' : '1px solid transparent',
      boxShadow: scrolled ? '0 1px 12px rgba(0,0,0,0.06)' : 'none',
      transition: 'all 0.3s ease',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '0 32px',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        height: 68,
      }}>
        
        {/* Logo */}
        <Link href="/" style={{ textDecoration: 'none' }}>
          <MiraxLogo size={32} />
        </Link>

        {/* Nav */}
        <nav style={{
          alignItems: 'center', gap: 32,
        }} className="hidden md:flex">
          {[
            { label: 'Come funziona', href: '#how-it-works' },
            { label: 'Funzionalità', href: '#arsenal' },
            { label: 'Prezzi', href: '#pricing' },
          ].map((item) => (
            <a key={item.label} href={item.href} style={{
              fontSize: 14, fontWeight: 500,
              color: '#475569', textDecoration: 'none',
              fontFamily: 'DM Sans, sans-serif',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#0F172A')}
            onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/login" style={{
            fontSize: 14, fontWeight: 500,
            color: '#475569', textDecoration: 'none',
            fontFamily: 'DM Sans, sans-serif',
            padding: '8px 16px',
          }}
          className="hidden sm:block"
          >
            Accedi
          </Link>
          <span className="hidden sm:inline-block">
            <CtaLink>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#6366F1',
                color: 'white', fontSize: 14, fontWeight: 600,
                padding: '9px 20px', borderRadius: 8,
                fontFamily: 'DM Sans, sans-serif',
                boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
                cursor: 'pointer', textDecoration: 'none',
                transition: 'all 0.2s',
              }}>
                Inizia Gratis
                <ArrowRight size={14} />
              </span>
            </CtaLink>
          </span>

          {/* Mobile menu button */}
          <button
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8 }}
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
        <div style={{
          background: 'white', borderTop: '1px solid #F1F5F9',
          padding: '16px 32px 24px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {['Come funziona', 'Funzionalità', 'Prezzi'].map((item) => (
            <a key={item} href="#" onClick={() => setMobileMenuOpen(false)} style={{
              fontSize: 15, fontWeight: 500, color: '#374151',
              textDecoration: 'none', fontFamily: 'DM Sans, sans-serif',
              paddingBottom: 12, borderBottom: '1px solid #F1F5F9',
            }}>
              {item}
            </a>
          ))}
          <Link href="/login" style={{
            fontSize: 15, fontWeight: 500, color: '#374151',
            textDecoration: 'none', fontFamily: 'DM Sans, sans-serif',
          }}>
            Accedi
          </Link>
          <CtaLink>
            <span style={{
              display: 'flex', justifyContent: 'center',
              background: '#6366F1', color: 'white',
              fontSize: 14, fontWeight: 600, padding: '11px 20px',
              borderRadius: 8, fontFamily: 'DM Sans, sans-serif',
            }}>
              Inizia Gratis →
            </span>
          </CtaLink>
        </div>
      )}
    </header>
  )
}
