// Draw a red count badge on the favicon (used for due task reminders).
// Falls back gracefully if canvas isn't available.

let originalHref: string | null = null;

function getLink(): HTMLLinkElement | null {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

export function setFaviconBadge(count: number) {
  const link = getLink();
  if (!link) return;
  if (originalHref === null) originalHref = link.getAttribute('href');

  if (count <= 0) {
    if (originalHref) { link.href = originalHref; link.type = 'image/svg+xml'; }
    return;
  }

  try {
    const img = new Image();
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);

      // red badge, top-right
      const r = 20, cx = size - r + 2, cy = r - 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e2445c';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px -apple-system, Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(count > 9 ? '9+' : String(count), cx, cy + 1);

      link.type = 'image/png';
      link.href = canvas.toDataURL('image/png');
    };
    img.onerror = () => { /* keep current favicon */ };
    img.src = '/bibix-logo.png';
  } catch { /* ignore */ }
}
