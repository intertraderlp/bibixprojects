import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Chats lives at /chats/ as its own installable PWA (vanilla JS, own service worker for push).
// Inside the Bibix app it is embedded here so it is also reachable from the Bibix PWA with the
// sidebar around it. Same origin → the Chats page reuses the login token from localStorage.
export default function ChatsPage() {
  const ref = useRef<HTMLIFrameElement>(null);
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('embed', '1');
  const src = '/chats/?' + params.toString();

  useEffect(() => {
    // Keep the browser tab title in sync with the unread count the Chats page sets.
    const t = setInterval(() => {
      try { const doc = ref.current?.contentDocument; if (doc?.title) document.title = doc.title; } catch { /* cross-origin never happens here */ }
    }, 2000);
    return () => { clearInterval(t); document.title = 'Bibix Projects'; };
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#f6f8f7]">
      <iframe
        ref={ref}
        title="Chats"
        src={src}
        className="flex-1 w-full border-0"
        allow="microphone; clipboard-write; clipboard-read"
      />
    </div>
  );
}
