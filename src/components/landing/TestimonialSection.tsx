'use client'

import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

const testimonials = [
  {
    quote: 'In 3 giorni ho trovato 14 ristoranti a Milano con pixel Facebook mancante. Ne ho contattati 10, ne ho chiusi 3. Quasi €5.000 di contratti nuovi partendo da zero chiamate a freddo.',
    name: 'Marco T.',
    role: 'Titolare agenzia SEO · Roma',
    avatar: 'MT',
    score: '+€4.800',
    tag: 'Ristorazione',
    metric: '3 clienti in 3 giorni',
    gradient: 'from-indigo-500 to-violet-500',
  },
  {
    quote: 'Usavo liste comprate. Tasso di risposta era il 2%. Con CKB cerco "aziende edili a Torino senza RC" e mi escono 30 prospect con contatti titolare e proposta già pronta.',
    name: 'Sara B.',
    role: 'Consulente digitale · Torino',
    avatar: 'SB',
    score: '15x risposta',
    tag: 'Healthcare',
    metric: '15x tasso risposta',
    gradient: 'from-cyan-500 to-blue-500',
  },
  {
    quote: 'La funzione Pitch AI mi risparmia 2 ore al giorno. Prima scrivevo ogni email da zero. Adesso: trovo il lead, leggo i suoi problemi, clicco Genera Pitch, copio, invio. 90 secondi.',
    name: 'Luca M.',
    role: 'Freelance Web · Milano',
    avatar: 'LM',
    score: '-2h/giorno',
    tag: 'Efficienza',
    metric: '90s dal lead al pitch',
    gradient: 'from-emerald-500 to-teal-500',
  },
]

export function TestimonialSection() {
  return (
    <section className="py-24 lg:py-32 bg-slate-950 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-950/50 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-violet-950/30 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span className="text-xs font-semibold text-indigo-400 font-['DM_Sans'] uppercase tracking-wider">Risultati Reali</span>
          </div>
          <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5 tracking-tight">
            Chi usa CKB{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              chiude di più.
            </span>
          </h2>
          <p className="text-lg text-slate-400 font-['DM_Sans'] max-w-lg mx-auto">
            Non promesse. Risultati concreti da agency e consulenti italiani.
          </p>
        </div>

        {/* Featured testimonial — large */}
        <motion.div
          className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8 lg:p-10 mb-6"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8">
            {/* Left: metric */}
            <div className="flex flex-col items-center justify-center text-center lg:border-r lg:border-white/10 lg:pr-8">
              <div className="font-['Syne'] text-4xl lg:text-5xl font-bold text-indigo-400 tracking-tight mb-2">
                {testimonials[0].score}
              </div>
              <div className="text-sm text-slate-500 font-['DM_Sans'] mb-3">
                {testimonials[0].metric}
              </div>
              <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full font-['DM_Sans'] uppercase tracking-wider">
                {testimonials[0].tag}
              </span>
            </div>

            {/* Right: quote */}
            <div>
              <div className="text-6xl leading-none text-white/5 font-serif mb-2">&ldquo;</div>
              <p className="text-lg lg:text-xl text-white/80 font-['DM_Sans'] leading-relaxed mb-8">
                {testimonials[0].quote}
              </p>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${testimonials[0].gradient} flex items-center justify-center text-white text-sm font-bold`}>
                    {testimonials[0].avatar}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white font-['DM_Sans']">{testimonials[0].name}</div>
                    <div className="text-xs text-slate-500 font-['DM_Sans']">{testimonials[0].role}</div>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {[0,1,2,3,4].map(i => (
                    <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Two smaller testimonials side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {testimonials.slice(1).map((t, idx) => (
            <motion.div
              key={t.name}
              className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 lg:p-7"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + idx * 0.15, duration: 0.5 }}
            >
              <div className="flex items-center gap-4 mb-5">
                <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${t.gradient} flex items-center justify-center text-white text-sm font-bold`}>
                  {t.avatar}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white font-['DM_Sans']">{t.name}</div>
                  <div className="text-xs text-slate-500 font-['DM_Sans']">{t.role}</div>
                </div>
                <div className="text-right">
                  <div className="font-['Syne'] text-xl font-bold text-white">{t.score}</div>
                  <div className="text-[10px] text-slate-500 font-['DM_Sans']">{t.metric}</div>
                </div>
              </div>
              <p className="text-sm text-white/70 font-['DM_Sans'] leading-relaxed mb-4">
                {t.quote}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white/30 bg-white/5 px-2.5 py-1 rounded-full font-['DM_Sans'] uppercase tracking-wider">
                  {t.tag}
                </span>
                <div className="flex gap-0.5">
                  {[0,1,2,3,4].map(i => (
                    <Star key={i} size={12} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
