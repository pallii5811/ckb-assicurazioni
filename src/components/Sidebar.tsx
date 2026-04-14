
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
    <div className="w-64 bg-white border-r border-slate-200 h-screen flex flex-col">
      {/* Logo */}
      <div className="p-5 pb-4 border-b border-slate-100">
        <button type="button" onClick={() => handleNavigate('/dashboard')} className="flex items-center">
          <MiraxLogo size={180} variant="dark" showWordmark={true} showTagline={false} />
        </button>
      </div>

      {/* Menu */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {menuItems.map((item, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => handleNavigate(item.href)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150 text-[13px] ${
                  pathname === item.href
                    ? 'bg-blue-50 text-blue-700 font-bold'
                    : 'text-slate-600 hover:bg-slate-50 text-slate-600 hover:text-slate-900 font-medium'
                }`}
              >
                <item.icon
                  className={`w-[18px] h-[18px] flex-shrink-0 ${
                    pathname === item.href ? 'text-blue-500' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Credits Progress */}
      <div className="p-3 border-t border-slate-100">
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-bold text-slate-700">Crediti</span>
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] px-1.5 py-0">
              {planLabel}
            </Badge>
          </div>

          <div className="mb-3">
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-slate-800 font-bold">{credits.toLocaleString('it-IT')}</span>
              <span className="text-slate-400">/ {planCredits.toLocaleString('it-IT')}</span>
            </div>
            <Progress value={creditsPercentage} className="h-1.5 bg-slate-200" />
            <p className="text-[10px] text-slate-400 mt-1">1 credito = 1 lead</p>
          </div>

          <Button
            type="button"
            onClick={() => handleNavigate('/dashboard/billing')}
            size="sm"
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-[12px] shadow-sm"
          >
            Upgrade
          </Button>

          <div className="mt-3 pt-3 border-t border-slate-200">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="w-full justify-center text-slate-500 hover:text-rose-600 hover:bg-rose-50/60 text-[12px]"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
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
