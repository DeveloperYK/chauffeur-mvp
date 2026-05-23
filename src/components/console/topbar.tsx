'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './avatar';
import { Icon } from './icons';

export function Topbar({ me }: { me: { id: string; name: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Keep input in sync if the URL changes elsewhere.
  useEffect(() => {
    setQ(searchParams.get('q') ?? '');
  }, [searchParams]);

  // "/" focuses search (Jira-style).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const submit = (value: string) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (value) params.set('q', value);
    else params.delete('q');
    router.push(`/dashboard?${params.toString()}`);
  };

  return (
    <header className="topbar">
      <a className="topbar__brand" href="/dashboard">
        <div className="topbar__mark">CD</div>
        <div className="topbar__name">v26</div>
      </a>
      <div className="topbar__crumbs" />
      <span className="topbar__spacer" />
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Icon.Search />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search passenger, address, account, vehicle…"
        />
        <kbd>/</kbd>
      </form>
      <button type="button" className="btn-pri-create btn" onClick={openCreate}>
        <Icon.Plus /> Create
      </button>
      <div className="topbar__me" title={me.name}>
        <Avatar name={me.name} id={me.id} size={26} />
      </div>
    </header>
  );
}
