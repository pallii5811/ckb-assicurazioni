'use client'

import { Shield, Lock, Server, Eye, Activity } from 'lucide-react'

const badges = [
  { icon: Shield, text: '100% GDPR Compliant' },
  { icon: Lock, text: 'Crittografia SSL/TLS' },
  { icon: Server, text: 'Server in EU' },
  { icon: Eye, text: 'Zero Data Sharing' },
  { icon: Activity, text: 'Uptime 99.9%' },
]

export function TrustBadges() {
  return (
    <section className="py-6 bg-slate-50 border-y border-slate-100">
      <div className="max-w-7xl mx-auto px-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
          {badges.map((badge) => (
            <div key={badge.text} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 transition-colors">
              <badge.icon size={15} className="text-indigo-400" />
              <span className="text-sm font-semibold font-['DM_Sans'] whitespace-nowrap">{badge.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
