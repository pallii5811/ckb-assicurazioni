import React from 'react'

interface CKBInsuranceLogoProps {
  size?: number
  variant?: 'light' | 'dark'
  showWordmark?: boolean
  showTagline?: boolean
  className?: string
}

export function CKBLogo({
  size = 36,
  variant = 'dark',
  showWordmark = true,
  showTagline = false,
  className = '',
}: CKBInsuranceLogoProps) {
  const iconSize = size

  if (showWordmark) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-700 to-indigo-900 shadow-lg shadow-blue-900/20 overflow-hidden">
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10 mix-blend-overlay"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
          <span className="relative text-white font-bold text-xl tracking-tighter z-10" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>
            CKB
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-extrabold tracking-tight text-slate-900 leading-none">
            CKB<span className="text-blue-700">Insurance</span>
          </span>
          <span className="text-[10px] font-medium tracking-widest text-slate-500 uppercase leading-none mt-1">
            Corporate Intelligence
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-[0.35em] ${className}`} style={{ lineHeight: 1 }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 40 40" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="ckb-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1D4ED8" />
            <stop offset="100%" stopColor="#312E81" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill="url(#ckb-bg)" />
        <path d="M11 28 L11 16 L20 22 Z" fill="white" opacity="0.55" />
        <path d="M11 16 L20 10 L20 22 Z" fill="white" opacity="0.95" />
        <path d="M20 10 L29 16 L20 22 Z" fill="white" opacity="0.95" />
        <path d="M29 16 L29 28 L20 22 Z" fill="white" opacity="0.55" />
      </svg>
    </div>
  )
}

export { CKBLogo as MiraxLogo }
export default CKBLogo