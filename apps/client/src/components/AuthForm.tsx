"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const r = useRouter();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr("");
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")), password = String(f.get("password"));
    try {
      if (mode === "signup") await api.signup({ email, password, displayName: String(f.get("displayName")) });
      else await api.login({ email, password });
      window.location.href = "/store";
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>{mode === "signup" ? "Sign up" : "Log in"}</h1>
      {mode === "signup" && <label>Display name<input name="displayName" minLength={2} maxLength={24} required /></label>}
      <label>Email<input name="email" type="email" required /></label>
      <label>Password<input name="password" type="password" minLength={8} required /></label>
      {mode === "signup" && <p className="mute">You get 500 demo coins. Names are reviewed before others see them.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <button disabled={busy}>{busy ? "…" : mode === "signup" ? "Create account" : "Log in"}</button>
    </form>
  );
}
