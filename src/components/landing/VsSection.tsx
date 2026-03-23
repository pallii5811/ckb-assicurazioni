 'use client'
 
 import { ArrowRight } from 'lucide-react'
 import CtaLink from '@/components/CtaLink'
 
 const rows = [
   { label: 'Qualità dei lead', cold: 'Lista acquistata, dati vecchi', mirax: 'Profilati e auditati in tempo reale' },
   { label: 'Tempo per 10 lead', cold: '3-4 ore di ricerca manuale', mirax: 'Meno di 2 minuti' },
   { label: 'Conosci il problema?', cold: 'No — parli al buio', mirax: 'Sì — SEO, pixel, DMARC, velocità' },
   { label: 'Pitch personalizzato', cold: 'Lo scrivi tu da zero', mirax: "Generato dall'AI in 1 click" },
   { label: 'Contatto titolare', cold: 'Raramente, spesso centralino', mirax: 'Cellulare verificato + email diretta' },
   { label: 'Tasso di risposta', cold: '1–3%', mirax: '10–20% (lead qualificato)' },
 ]
 
 export function VsSection() {
   return (
     <section style={{
       background: 'white',
       padding: '96px 32px',
       borderBottom: '1px solid #F1F5F9',
     }}>
       <div style={{ maxWidth: 1100, margin: '0 auto' }}>
 
         {/* Header */}
         <div style={{
           display: 'grid',
           marginBottom: 56,
           alignItems: 'center',
         }} className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
           <div>
             <div style={{
               display: 'inline-flex', alignItems: 'center',
               background: '#F8FAFC', border: '1px solid #E2E8F0',
               borderRadius: 999, padding: '6px 16px',
               fontSize: 11, fontWeight: 600,
               color: '#64748B', letterSpacing: '0.08em',
               textTransform: 'uppercase', marginBottom: 20,
               fontFamily: 'DM Sans, sans-serif',
             }}>
               Il Confronto
             </div>
             <h2 style={{
               fontFamily: 'Syne, sans-serif',
               fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
               fontWeight: 600,
               letterSpacing: '-0.025em',
               color: '#0F172A',
             }}>
               MIRAX vs{' '}
               <span style={{
                 color: '#CBD5E1',
                 textDecoration: 'line-through',
                 textDecorationColor: '#EF4444',
                 textDecorationThickness: 3,
               }}>
                 Lista Fredda
               </span>
             </h2>
           </div>
           <div>
             <p style={{
               fontSize: 16, color: '#64748B',
               lineHeight: 1.7, fontFamily: 'DM Sans, sans-serif',
               marginBottom: 24,
             }}>
               Non è una questione di strumenti. 
               È una questione di chi chiami — e cosa gli dici.
             </p>
             <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
               <div style={{ textAlign: 'center' }}>
                 <div style={{
                   fontSize: 28, fontWeight: 700,
                   color: '#EF4444',
                   fontFamily: 'Syne, sans-serif',
                 }}>
                   1-3%
                 </div>
                 <div style={{
                   fontSize: 11, color: '#94A3B8',
                   fontFamily: 'DM Sans, sans-serif',
                 }}>
                   Lista fredda
                 </div>
               </div>
               <div style={{ fontSize: 20, color: '#CBD5E1' }}>→</div>
               <div style={{ textAlign: 'center' }}>
                 <div style={{
                   fontSize: 28, fontWeight: 700,
                   color: '#6366F1',
                   fontFamily: 'Syne, sans-serif',
                 }}>
                   10-20%
                 </div>
                 <div style={{
                   fontSize: 11, color: '#94A3B8',
                   fontFamily: 'DM Sans, sans-serif',
                 }}>
                   Con MIRAX
                 </div>
               </div>
             </div>
           </div>
         </div>
 
         {/* Table */}
         <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
           <div style={{
             border: '1px solid #E2E8F0',
             borderRadius: 16, overflow: 'hidden',
             boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
             marginBottom: 40,
             minWidth: 600,
           }}>
             {/* Header */}
             <div style={{
               display: 'grid',
               gridTemplateColumns: '2fr 1.5fr 1.5fr',
               background: '#F8FAFC',
               borderBottom: '1px solid #E2E8F0',
             }}>
               <div style={{ padding: '16px 20px' }}>
                 <span style={{
                   fontSize: 11, fontWeight: 700,
                   color: '#94A3B8', textTransform: 'uppercase',
                   letterSpacing: '0.08em',
                   fontFamily: 'DM Sans, sans-serif',
                 }}>
                   Funzionalità
                 </span>
               </div>
               <div style={{
                 padding: '16px 20px',
                 borderLeft: '1px solid #E2E8F0',
                 textAlign: 'center',
               }}>
                 <span style={{
                   fontSize: 12, fontWeight: 700,
                   color: '#94A3B8',
                   textDecoration: 'line-through',
                   textDecorationColor: '#EF4444',
                   fontFamily: 'DM Sans, sans-serif',
                   textTransform: 'uppercase',
                   letterSpacing: '0.06em',
                 }}>
                   Lista Fredda
                 </span>
               </div>
               <div style={{
                 padding: '16px 20px',
                 borderLeft: '1px solid #6366F1',
                 textAlign: 'center',
                 background: '#6366F1',
               }}>
                 <span style={{
                   fontSize: 12, fontWeight: 700,
                   color: 'white', fontFamily: 'DM Sans, sans-serif',
                   textTransform: 'uppercase',
                   letterSpacing: '0.06em',
                 }}>
                   MIRAX ✓
                 </span>
               </div>
             </div>
 
             {rows.map((row, i) => (
               <div key={i} style={{
                 display: 'grid',
                 gridTemplateColumns: '2fr 1.5fr 1.5fr',
                 borderTop: '1px solid #F1F5F9',
                 background: i % 2 === 0 ? 'white' : '#FAFAFA',
                 transition: 'background 0.15s',
               }}>
                 <div style={{ padding: '16px 20px' }}>
                   <span style={{
                     fontSize: 13, fontWeight: 600,
                     color: '#334155',
                     fontFamily: 'DM Sans, sans-serif',
                   }}>
                     {row.label}
                   </span>
                 </div>
                 <div style={{
                   padding: '16px 20px',
                   borderLeft: '1px solid #F1F5F9',
                   display: 'flex', alignItems: 'center', gap: 8,
                 }}>
                   <span style={{
                     width: 18, height: 18, borderRadius: '50%',
                     background: '#FEF2F2',
                     display: 'inline-flex', alignItems: 'center',
                     justifyContent: 'center', flexShrink: 0,
                     fontSize: 9, fontWeight: 700, color: '#EF4444',
                   }}>
                     ✗
                   </span>
                   <span style={{
                     fontSize: 13, color: '#94A3B8',
                     fontFamily: 'DM Sans, sans-serif',
                   }}>
                     {row.cold}
                   </span>
                 </div>
                 <div style={{
                   padding: '16px 20px',
                   borderLeft: '1px solid #EEF2FF',
                   background: '#FAFBFF',
                   display: 'flex', alignItems: 'center', gap: 8,
                 }}>
                   <span style={{
                     width: 18, height: 18, borderRadius: '50%',
                     background: '#EEF2FF',
                     display: 'inline-flex', alignItems: 'center',
                     justifyContent: 'center', flexShrink: 0,
                     fontSize: 9, fontWeight: 700, color: '#6366F1',
                   }}>
                     ✓
                   </span>
                   <span style={{
                     fontSize: 13, fontWeight: 600,
                     color: '#334155',
                     fontFamily: 'DM Sans, sans-serif',
                   }}>
                     {row.mirax}
                   </span>
                 </div>
               </div>
             ))}
           </div>
         </div>

         {/* CTA */}
         <div style={{ textAlign: 'center' }}>
           <CtaLink>
             <span style={{
               display: 'inline-flex', alignItems: 'center', gap: 8,
               background: '#6366F1', color: 'white',
               fontSize: 15, fontWeight: 600,
               padding: '14px 32px', borderRadius: 12,
               fontFamily: 'DM Sans, sans-serif',
               boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
               cursor: 'pointer',
             }}>
               Prova MIRAX Gratis
               <ArrowRight size={16} />
             </span>
           </CtaLink>
           <p style={{
             fontSize: 12, color: '#94A3B8',
             fontFamily: 'DM Sans, sans-serif',
             marginTop: 12,
           }}>
             Nessuna carta richiesta · 10 lead gratis
           </p>
         </div>
 
       </div>
     </section>
   )
 }
