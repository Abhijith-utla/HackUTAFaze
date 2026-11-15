"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function Header() {
  const [me, setMe] = useState<{ name: string; balance: number } | null>(null);
  useEffect(() => {
    api.me().then((r) => setMe({ name: r.user.displayName, balance: r.balance })).catch(() => setMe(null));
  }, []);
  return (
    <header className="top">
      <Link href="/" className="logo">FAZE CARDS</Link>
      <nav><Link href="/store">Store</Link><Link href="/collection">Collection</Link><Link href="/trades">Trades</Link><Link href="/leaderboard">Leaderboard</Link></nav>
      {me ? (
        <span>{me.name} · {me.balance} coins <span className="badge">demo</span></span>
      ) : (
        <span><Link href="/login">Log in</Link> · <Link href="/signup">Sign up</Link></span>
      )}
    </header>
  );
}
