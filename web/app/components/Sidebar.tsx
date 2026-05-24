'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  BriefcaseBusiness,
  Telescope,
  BarChart2,
  BotMessageSquare,
  Mail,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const nav = [
  { href: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/portfolio',   label: 'Portfolio',   icon: BriefcaseBusiness },
  { href: '/research',    label: 'Research',    icon: Telescope },
  { href: '/performance', label: 'Performance', icon: BarChart2 },
  { href: '/agent',       label: 'Agent',       icon: Bot },
  { href: '/letter',      label: 'Letter',      icon: Mail },
];

export default function Sidebar() {
  const pathname  = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 h-screen sticky top-0 bg-panel border-r border-rim flex flex-col transition-all duration-200`}>
      {/* Header */}
      <div className={`py-5 border-b border-rim flex items-center gap-2.5 ${collapsed ? 'px-3 justify-center' : 'px-5'}`}>
        <BotMessageSquare size={20} className="text-accent shrink-0" />
        {!collapsed && <span className="font-semibold text-ink tracking-tight flex-1">Alpha Agent</span>}
        {!collapsed && (
          <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
            Paper
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-4 space-y-0.5 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center rounded-lg text-sm transition-colors ${
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
              } ${
                active
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-dim hover:text-ink hover:bg-ink/5'
              }`}
            >
              <Icon size={16} />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* Toggle bar */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-dim hover:text-ink hover:bg-ink/5 border-t border-rim transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        {!collapsed && <span className="text-xs">Collapse</span>}
      </button>

      {/* Footer */}
      <div className={`py-3 border-t border-rim flex items-center ${collapsed ? 'justify-center px-3' : 'px-5 gap-2'}`}>
        <span className="w-2 h-2 rounded-full bg-gain animate-pulse shrink-0" title="Agent running" />
        {!collapsed && <span className="text-xs text-dim">Agent running</span>}
      </div>
    </aside>
  );
}
