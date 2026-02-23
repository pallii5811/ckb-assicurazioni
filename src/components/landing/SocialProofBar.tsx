
'use client'

export default function SocialProofBar() {
  const avatars = [
    { initials: 'MR', bg: '#6366F1' },
    { initials: 'SF', bg: '#8B5CF6' },
    { initials: 'AG', bg: '#06B6D4' },
    { initials: 'LP', bg: '#10B981' },
    { initials: 'TC', bg: '#F59E0B' },
  ]

  const stats = [
    { value: '3M+', label: 'Aziende nel DB' },
    { value: '< 2 min', label: 'Dal click al lead' },
    { value: '4.9/5', label: '200+ agenzie' },
  ]

  return (
    <section style={{
      background: '#F8FAFC',
      borderTop: '1px solid #F1F5F9',
      borderBottom: '1px solid #F1F5F9',
      padding: '16px 32px',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 48,
        flexWrap: 'wrap',
      }}>

        {/* Avatars + rating */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex' }}>
            {avatars.map((a, i) => (
              <div key={i} style={{
                width: 32, height: 32, borderRadius: '50%',
                background: a.bg,
                border: '2px solid white',
                marginLeft: i === 0 ? 0 : -8,
                display: 'flex', alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'white',
                fontFamily: 'DM Sans, sans-serif',
                zIndex: avatars.length - i,
                position: 'relative',
              }}>
                {a.initials}
              </div>
            ))}
          </div>
          <div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: '#0F172A', fontFamily: 'DM Sans, sans-serif',
            }}>
              ★★★★★{' '}
              <span style={{ color: '#6366F1' }}>4.9/5</span>
            </div>
            <div style={{
              fontSize: 11, color: '#94A3B8',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              200+ agenzie italiane
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 32, background: '#E2E8F0' }} className="hidden sm:block" />

        {/* Stats */}
        {stats.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 16, fontWeight: 700,
                color: '#0F172A', fontFamily: 'Syne, sans-serif',
                letterSpacing: '-0.02em',
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize: 11, color: '#94A3B8',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {s.label}
              </div>
            </div>
            {i < stats.length - 1 && (
              <div style={{ width: 1, height: 32, background: '#E2E8F0' }} className="hidden sm:block" />
            )}
          </div>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 32, background: '#E2E8F0' }} className="hidden sm:block" />

        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#10B981', display: 'block',
              boxShadow: '0 0 0 3px rgba(16,185,129,0.2)',
            }} />
          </span>
          <span style={{
            fontSize: 12, color: '#475569', fontWeight: 500,
            fontFamily: 'DM Sans, sans-serif',
          }}>
            Database live aggiornato
          </span>
        </div>

      </div>
    </section>
  )
}
