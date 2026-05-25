'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from './avatar';
import { Icon } from './icons';
import { SearchPalette } from './search-palette';

export function Topbar({ me }: { me: { id: string; name: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Open the create-booking modal. On the board we have a live console shell
  // listening for the event (instant); elsewhere we navigate to the board with
  // ?new=1, which opens the modal on mount.
  const openCreate = () => {
    if (pathname === '/dashboard') {
      window.dispatchEvent(new Event('console:new-booking'));
    } else {
      router.push('/dashboard?new=1');
    }
  };

  // "/" or ⌘K / Ctrl+K opens the global search palette (Jira / Linear style),
  // unless the operator is already typing in a field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !typing;
      if (cmdK || slash) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="topbar">
      <a className="topbar__brand" href="/dashboard">
        <div className="topbar__mark">CD</div>
        <div className="topbar__name">v26</div>
      </a>
      <div className="topbar__crumbs" />
      <span className="topbar__spacer" />
      <button type="button" className="search search--trigger" onClick={() => setPaletteOpen(true)}>
        <Icon.Search />
        <span className="search__placeholder">Search by ID, driver, passenger…</span>
        <kbd>⌘K</kbd>
      </button>
      <button type="button" className="btn-pri-create btn" onClick={openCreate}>
        <Icon.Plus /> Create
      </button>
      <div className="topbar__me" title={me.name}>
        <Avatar name={me.name} id={me.id} size={26} />
      </div>
      <SearchPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
