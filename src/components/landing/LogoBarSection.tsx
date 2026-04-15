'use client'

export function LogoBarSection() {
  const agencies = [
    { name: 'Assitalia Broker', city: 'Roma' },
    { name: 'Nordest Assicurazioni', city: 'Milano' },
    { name: 'Studio Bianchi & Partners', city: 'Torino' },
    { name: 'Emilia Insurance Group', city: 'Bologna' },
    { name: 'Campania Broker', city: 'Napoli' },
    { name: 'Adriatica Intermediazioni', city: 'Venezia' },
    { name: 'Puglia Risk Consulting', city: 'Bari' },
    { name: 'Toscana Broker', city: 'Firenze' },
  ]

  // Duplica per loop infinito seamless
  const items = [...agencies, ...agencies]

  return (
    <section className="py-12 border-y border-gray-100 bg-white overflow-hidden" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <style jsx global>{`
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>

      <p className="text-center text-xs font-semibold uppercase tracking-widest text-gray-400 mb-8">
        Già scelto da broker e intermediari in tutta Italia
      </p>

      <div className="relative">
        {/* Fade laterale sinistro */}
        <div
          className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, white, transparent)' }}
        />
        {/* Fade laterale destro */}
        <div
          className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(270deg, white, transparent)' }}
        />

        {/* Marquee track */}
        <div
          className="flex gap-12 w-max"
          style={{
            animation: 'marquee 28s linear infinite',
          }}
        >
          {items.map((agency, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-200 bg-gray-50 whitespace-nowrap flex-shrink-0"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              {/* Dot colorato per "alive" */}
              <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-700">{agency.name}</span>{' '}
              <span className="text-xs text-gray-400">{agency.city}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
