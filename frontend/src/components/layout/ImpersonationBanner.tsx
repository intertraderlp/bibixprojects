import { UserCog, LogOut } from 'lucide-react';
import { impersonationInfo, exitImpersonation } from '../../lib/impersonation';

/** A persistent bar shown while an admin is signed in as another user. */
export default function ImpersonationBanner() {
  const info = impersonationInfo();
  if (!info) return null;

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-amber-500 text-white text-sm font-medium shadow-sm z-50">
      <UserCog size={16} className="flex-shrink-0" />
      <span className="truncate">
        You're signed in as <strong>{info.target}</strong> — viewing the app as this user.
      </span>
      <button
        onClick={() => exitImpersonation()}
        className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-md font-semibold transition-colors flex-shrink-0"
      >
        <LogOut size={14} /> Return to my account
      </button>
    </div>
  );
}
