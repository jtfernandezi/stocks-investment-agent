import Sidebar from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';

interface PageShellProps {
  children: React.ReactNode;
}

export default function PageShell({ children }: PageShellProps) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6 space-y-4 md:space-y-6 w-full">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
