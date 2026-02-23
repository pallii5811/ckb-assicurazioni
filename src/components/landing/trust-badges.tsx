'use client'

import { Shield, Lock, Server, Eye, Activity } from 'lucide-react'

const badges = [
  { icon: Shield, text: '100% GDPR Compliant', accent: '#6366F1' },
  { icon: Lock, text: 'Crittografia SSL/TLS', accent: '#0EA5E9' },
  { icon: Server, text: 'Server in EU', accent: '#10B981' },
  { icon: Eye, text: 'Zero Data Sharing', accent: '#8B5CF6' },
  { icon: Activity, text: 'Uptime 99.9%', accent: '#F59E0B' },
] as const

export function TrustBadges() {
  return (
    <section style={{
      background: 'white',
      borderTop: '1px solid #F1F5F9',
      borderBottom: '1px solid #F1F5F9',
      padding: '20px 32px',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
      }}>
        <div style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 14,
          padding: '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
          flexWrap: 'wrap',
        }}>
          {badges.map((badge) => (
            <div key={badge.text} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '0.7'}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: `${badge.accent}12`,
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0,
              }}>
                <badge.icon size={14} color={badge.accent} />
              </div>
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: '#475569',
                fontFamily: 'DM Sans, sans-serif',
                whiteSpace: 'nowrap',
              }}>
                {badge.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
