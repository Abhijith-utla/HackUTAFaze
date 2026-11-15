"use client";
// ⌘K / Ctrl+K command palette: every screen and the common actions, one keystroke away.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib";

type Cmd = { id: string; label: string; group: string; hint?: string; href?: string; run?: () => Promise<string | void> };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const cmds = useMemo<Cmd[]>(() => [
    { id: "home", group: "Go to", label: "Home", href: "/admin/control" },
    { id: "kam", group: "Go to", label: "KAM Intelligence", hint: "what to drop next", href: "/admin/control/kam" },
    { id: "scout", group: "Go to", label: "Moment Scout", hint: "YouTube discovery", href: "/admin/control/scout" },
    { id: "studio", group: "Go to", label: "Moment Studio", hint: "drafts & approvals", href: "/admin/control/studio" },
    { id: "campaigns", group: "Go to", label: "Campaign Command", hint: "launch & live drops", href: "/admin/control/campaigns" },
    { id: "analytics", group: "Go to", label: "Analytics", hint: "KPIs & charts", href: "/admin/control/analytics" },
    { id: "fans", group: "Go to", label: "Fan Intelligence", hint: "funnel, cohorts", href: "/admin/control/fans" },
    { id: "revenue", group: "Go to", label: "Revenue & Sponsors", href: "/admin/control/revenue" },
    { id: "trust", group: "Go to", label: "Trust & Operations", hint: "moderation, rights, jobs", href: "/admin/control/trust" },
    { id: "audit", group: "Go to", label: "Audit log", href: "/admin/control/audit" },
    { id: "sets", group: "Content", label: "Sets", href: "/admin/control/content?view=sets" },
    { id: "cards", group: "Content", label: "Cards", href: "/admin/control/content?view=cards" },
    { id: "packs", group: "Content", label: "Packs", href: "/admin/control/content?view=packs" },
    { id: "mod", group: "Content", label: "Moderation queue", href: "/admin/control/content?view=moderation" },
    { id: "spike", group: "Content", label: "Engagement spike (demo)", href: "/admin/control/content?view=engagement" },
    { id: "scan", group: "Actions", label: "Run a KAM scan", hint: "rank the archive now", run: async () => { await api("/admin/control/kam/scan", "POST"); router.push("/admin/control/kam"); return "Scan complete"; } },
    { id: "sponsor", group: "Actions", label: "Add a sponsor", href: "/admin/control/revenue" },
    { id: "fan", group: "Actions", label: "Open the fan app", href: "/" },
  ], [router]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cmds.filter((c) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(s)) : cmds;
  }, [cmds, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) { setQ(""); setI(0); setStatus(""); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);
  useEffect(() => setI(0), [q]);

  async function choose(c: Cmd | undefined) {
    if (!c) return;
    if (c.href) { setOpen(false); router.push(c.href); return; }
    if (c.run) {
      setStatus(`${c.label}…`);
      try { const m = await c.run(); setStatus(m ?? "Done"); setOpen(false); }
      catch (e) { setStatus((e as Error).message); }
    }
  }

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="cmd-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a screen or run an action…"
          aria-label="Search commands"
          aria-controls="cmd-list"
          aria-activedescendant={list[i] ? `cmd-${list[i].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); void choose(list[i]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        <ul id="cmd-list" role="listbox">
          {list.map((c, idx) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <li key={c.id} role="presentation">
                {head && <p className="cmd-group">{head}</p>}
                <button id={`cmd-${c.id}`} role="option" aria-selected={idx === i} className={idx === i ? "on" : ""} onMouseEnter={() => setI(idx)} onClick={() => void choose(c)}>
                  <span>{c.label}</span>
                  {c.hint && <small>{c.hint}</small>}
                </button>
              </li>
            );
          })}
          {!list.length && <li className="cmd-none">No matches.</li>}
        </ul>
        <p className="cmd-foot">{status || <>↑↓ to move · Enter to open · Esc to close</>}</p>
      </div>
    </div>
  );
}
