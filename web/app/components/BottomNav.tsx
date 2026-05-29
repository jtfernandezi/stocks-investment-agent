'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BriefcaseBusiness,
  Telescope,
  BarChart2,
  Bot,
  Mail,
} from 'lucide-react';

const nav = [
  { href: '/',            label: 'Home',      icon: LayoutDashboard },
  { href: '/portfolio',   label: 'Portfolio', icon: BriefcaseBusiness },
  { href: '/research',    label: 'Research',  icon: Telescope },
  { href: '/performance', label: 'Perf',      icon: BarChart2 },
  { href: '/agent',       label: 'Agent',     icon: Bot },
  { href: '/letter',      label: 'Letter',    icon: Mail },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-panel/95 backdrop-blur-sm border-t border-rim">
      <div className="flex items-center justify-around px-1 pt-2 pb-6">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-2 py-1 rounded-lg min-w-0 transition-colors ${
                active ? 'text-accent' : 'text-dim'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.75} />
              <span className="text-[10px] leading-none font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
