
'use client'

import { Search, List, Plug, CreditCard, Crown, LogOut, Folder, BarChart2, User, Kanban, Brain, Send } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/utils/supabase/client'
import MiraxLogo from '@/components/MiraxLogo'
import { useDashboard, PLAN_CREDITS, PLAN_LABELS } from '@/components/DashboardContext'

type SidebarProps = {
  credits: number
  variant?: 'desktop' | 'mobile'
  open?: boolean
  onClose?: () => void
  onNavigate?: () => void
}

const Sidebar = ({ credits, variant = 'desktop', open = false, onClose, onNavigate }: SidebarProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const { planType } = useDashboard()
  const planCredits = PLAN_CREDITS[planType] || 100
  const planLabel = PLAN_LABELS[planType] || 'Free'
  const creditsPercentage = Math.max(0, Math.min(100, (credits / planCredits) * 100))
  const usedCredits = Math.max(0, planCredits - credits)
  const onLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const menuItems = [
    { icon: Search, label: 'Ricerca', href: '/dashboard' },
    { icon: List, label: 'Le mie Liste', href: '/dashboard/leads' },
    { icon: Folder, label: 'Ambienti', href: '/dashboard/environments' },
    { icon: Kanban, label: 'Pipeline', href: '/dashboard/pipeline' },
    { icon: Brain, label: 'Smart Insights', href: '/dashboard/insights' },
    { icon: Send, label: 'Sequenze Email', href: '/dashboard/sequences' },
    { icon: BarChart2, label: 'Il Mio Score AI', href: '/dashboard/stats' },
    { icon: Plug, label: 'Integrazioni', href: '/dashboard/integrations' },
    { icon: CreditCard, label: 'Billing', href: '/dashboard/billing' },
    { icon: User, label: 'Profilo', href: '/dashboard/profile' },
  ]

  const handleNavigate = (href: string) => {
    router.push(href)
    onNavigate?.()
  }

  const content = (
    <div className="w-64 bg-white border-r border-gray-100 h-screen flex flex-col shadow-xl">
      {/* Logo */}
      <div className="p-6 border-b border-gray-100">
        <div className="relative inline-flex">
          <div className="pointer-events-none absolute -inset-3 rounded-2xl bg-violet-500/10 blur-xl" />
          <button type="button" onClick={() => handleNavigate('/dashboard')} className="relative flex items-center">
            <MiraxLogo size={200} variant="dark" showWordmark={true} showTagline={false} />
          </button>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {menuItems.map((item, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => handleNavigate(item.href)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors duration-150 ${
                  pathname === item.href
                    ? 'bg-gradient-to-r from-violet-50 to-blue-50 text-violet-700 border-l-[3px] border-violet-600'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <item.icon
                  className={`w-5 h-5 ${
                    item.href === '/dashboard'
                      ? 'text-violet-600'
                      : item.href === '/dashboard/leads'
                        ? 'text-blue-600'
                        : item.href === '/dashboard/environments'
                          ? 'text-amber-600'
                          : item.href === '/dashboard/stats'
                            ? 'text-emerald-600'
                            : item.href === '/dashboard/integrations'
                              ? 'text-fuchsia-600'
                              : 'text-slate-600'
                  } ${pathname === item.href ? 'opacity-100' : 'opacity-90'}`}
                />
                <span className="font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Credits Progress */}
      <div className="p-4 border-t border-gray-100">
        <div className="bg-gradient-to-br from-violet-50 to-blue-50 rounded-xl p-4 border border-violet-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Crown className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-semibold text-gray-900">Crediti Mensili</span>
            </div>
            <Badge variant="secondary" className="bg-violet-100 text-violet-700 border-violet-200">
              {planLabel}
            </Badge>
          </div>

          <div className="mb-3">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 font-medium">Disponibili: {credits.toLocaleString('it-IT')}</span>
              <span className="text-gray-500">Totali: {planCredits.toLocaleString('it-IT')}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>Usati: {usedCredits.toLocaleString('it-IT')}</span>
              <span>{creditsPercentage.toFixed(0)}%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">1 credito = 1 lead</p>
            <Progress value={creditsPercentage} className="h-2 bg-violet-100" />
          </div>

          <Button
            type="button"
            onClick={() => handleNavigate('/dashboard/billing')}
            className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white font-semibold shadow-lg transition-all duration-200 cta-glow-hover"
          >
            Upgrade
          </Button>

          <div className="mt-4 pt-4 border-t border-violet-200/60">
            <Button
              type="button"
              variant="ghost"
              onClick={onLogout}
              className="w-full justify-center text-gray-700 hover:text-rose-700 hover:bg-rose-50/60"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  if (variant === 'mobile') {
    return (
      <>
        <div
          className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity md:hidden ${
            open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={onClose}
        />
        <div
          className={`fixed top-0 left-0 z-50 h-screen md:hidden transform transition-transform duration-200 ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {content}
        </div>
      </>
    )
  }

  return <div className="hidden md:block">{content}</div>
}

export default Sidebar
