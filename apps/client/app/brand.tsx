'use client';

import { useEffect, useRef, useState } from 'react';

/** Original toolkit mark. Never recreate or recolor a missing brand asset. */
export default function Brand({ label = 'ClipDeck' }: { label?: string }) {
  const [missing, setMissing] = useState(false);
  const mark = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (mark.current?.complete && !mark.current.naturalWidth) setMissing(true);
  }, []);
  return <a className="brand vault-brand" href="/" aria-label={`FaZe ${label} home`}>
    {!missing && <span className="vault-mark"><img ref={mark} src="/brand/faze-mark-dark.png" alt="FaZe" width={40} height={40} onError={() => setMissing(true)} /></span>}
    <span className="vault-brand-name">{missing ? 'FaZe / ' : ''}{label}</span>
  </a>;
}
