import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ImpersonationBanner from './ImpersonationBanner';

export default function Layout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
      <ImpersonationBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
