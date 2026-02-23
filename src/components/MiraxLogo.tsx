import React from 'react'

interface MiraxLogoProps {
  size?: number
  variant?: 'light' | 'dark'
  showWordmark?: boolean
  showTagline?: boolean
  className?: string
}

export function MiraxLogo({
  size = 36,
  variant = 'dark',
  showWordmark = true,
  showTagline = false,
  className = '',
}: MiraxLogoProps) {
  const iconSize = size

  // Use clean SVG for full logo (with wordmark), icon-only SVG for showWordmark=false
  if (showWordmark) {
    return (
      <div className={className} style={{ lineHeight: 1 }}>
        <img
          src="/mirax-logo-clean.svg"
          alt="MiraX"
          style={{ 
            width: `${size}px`,
            height: 'auto',
            display: 'block'
          }}
        />
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-[0.35em] ${className}`} style={{ lineHeight: 1 }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 40 40" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="mirax-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6B9FFF" />
            <stop offset="100%" stopColor="#9B7FFF" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill="url(#mirax-bg)" />
        <path d="M11 28 L11 16 L20 22 Z" fill="white" opacity="0.55" />
        <path d="M11 16 L20 10 L20 22 Z" fill="white" opacity="0.95" />
        <path d="M20 10 L29 16 L20 22 Z" fill="white" opacity="0.95" />
        <path d="M29 16 L29 28 L20 22 Z" fill="white" opacity="0.55" />
      </svg>
    </div>
  )
}

export default MiraxLogo