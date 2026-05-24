'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BriefcaseBusiness,
  Telescope,
  BarChart2,
  BotMessageSquare,
  Mail,
  Bot,
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
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 min-h-screen bg-panel border-r border-rim flex flex-col">
      <div className="px-5 py-5 border-b border-rim flex items-center gap-2.5">
        <BotMessageSquare size={20} className="text-accent" />
        <span className="font-semibold text-ink tracking-tight">Alpha Agent</span>
        <span className="ml-auto text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
          Paper
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-dim hover:text-ink hover:bg-ink/5'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-rim">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gain animate-pulse" />
          <span className="text-xs text-dim">Agent running</span>
        </div>
      </div>
    </aside>
  );
}
