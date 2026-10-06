type PublicStatus = { online: boolean; players?: { online: number; max: number } };

const REFRESH_MS = 60_000;

function setStatus(el: HTMLElement, state: 'online' | 'offline', text: string) {
  el.dataset.state = state;
  const t = el.querySelector('.status-text');
  if (t) t.textContent = text;
}

async function refreshStatus() {
  const els = [...document.querySelectorAll<HTMLElement>('[data-status-for]')].filter((e) => e.dataset.state !== 'on-request');
  if (els.length === 0) return;
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, PublicStatus>;
    for (const el of els) {
      const s = data[el.dataset.statusFor!];
      if (!s) continue;
      if (s.online) setStatus(el, 'online', s.players ? `Online · ${s.players.online}/${s.players.max}` : 'Online');
      else setStatus(el, 'offline', 'Offline');
    }
    const total = Object.values(data).reduce((sum, s) => sum + (s.online && s.players ? s.players.online : 0), 0);
    document.querySelectorAll('[data-total-online]').forEach((el) => (el.textContent = String(total)));
  } catch {
    // Leave indicators as they are; the page works without status.
  }
}

function startPolling() {
  refreshStatus();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshStatus();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStatus();
  });
}

function setupCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>('button.copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); // the button sits inside <summary>; don't toggle the card
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(btn.dataset.copy ?? '');
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
  });
}

function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  let el: HTMLElement | null = target;
  while (el) {
    if (el instanceof HTMLDetailsElement) el.open = true;
    el = el.parentElement;
  }
  target.scrollIntoView({ block: 'start' });
}

setupCopyButtons();
openFromHash();
window.addEventListener('hashchange', openFromHash);
startPolling();
