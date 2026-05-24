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
    <aside className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 min-h-screen bg-panel border-r border-rim flex flex-col transition-all duration-200`}>
      {/* Header */}
      <div className={`py-5 border-b border-rim flex items-center gap-2.5 ${collapsed ? 'px-0 justify-center' : 'px-5'}`}>
        {!collapsed && <BotMessageSquare size={20} className="text-accent" />}
        {!collapsed && <span className="font-semibold text-ink tracking-tight">Alpha Agent</span>}
        {!collapsed && (
          <span className="ml-auto text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
            Paper
          </span>
        )}
        {collapsed && <BotMessageSquare size={20} className="text-accent" />}
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-4 space-y-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
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

      {/* Footer */}
      <div className={`py-4 border-t border-rim ${collapsed ? 'px-0 flex flex-col items-center gap-3' : 'px-5'}`}>
        {!collapsed && (
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-gain animate-pulse" />
            <span className="text-xs text-dim">Agent running</span>
          </div>
        )}
        {collapsed && <span className="w-2 h-2 rounded-full bg-gain animate-pulse" title="Agent running" />}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-dim hover:text-ink hover:bg-ink/5 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
    </aside>
  );
}
