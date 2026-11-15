"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Card, CardSet, Pack, Submission, User } from "@faze/shared";
import { API } from "../../lib/api";
type AdminPack = Pack & { active: boolean };
type View = "sets" | "cards" | "packs" | "moderation" | "engagement";
async function api(path: string, method = "GET", body?: unknown) {
  // Never hang the console: a stuck API (e.g. waiting on its database) surfaces as an error after 15 s.
  const r = await fetch(API + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => {
    throw Error(e.name === "TimeoutError" ? `The API at ${API} didn't answer within 15 seconds. Check that the API is running and can reach its database, then retry.` : `Can't reach the API at ${API} (${e.message}).`);
  });
  const data = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw Error(data.error?.message ?? `Request failed (${r.status})`);
  return data;
}
function values(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
export default function Page() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState<View>("sets"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [sets, setSets] = useState<CardSet[]>([]),
    [cards, setCards] = useState<Card[]>([]),
    [packs, setPacks] = useState<AdminPack[]>([]),
    [subs, setSubs] = useState<Submission[]>([]),
    [editing, setEditing] = useState<any>(null),
    [art, setArt] = useState("");
  async function load() {
    const [s, c, p, m] = await Promise.all([
      api("/admin/sets"),
      api("/admin/cards"),
      api("/admin/packs"),
      api("/admin/moderation?status=pending"),
    ]);
    setSets(s.sets);
    setCards(c.cards);
    setPacks(p.packs);
    setSubs(m.submissions);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api("/me")
      .then(async (d) => {
        setUser(d.user);
        if (d.user.role === "admin") await load();
      })
      .catch((e) => {
        if (!/log|auth|session/i.test(e.message)) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  function tab(v: View) {
    setView(v);
    setEditing(null);
    setArt("");
    setError("");
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024)
      throw Error("Art must be no larger than 2 MB");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw Error("Choose PNG, JPEG or WebP");
    const bytes = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(Error("Cannot read image"));
      reader.readAsDataURL(file);
    });
    const result = await api("/admin/art", "POST", {
      base64: bytes,
      mimeType: file.type,
    });
    setArt(result.artUrl);
    setNotice("Art uploaded. Save the card to attach it.");
  }
  if (loading)
    return (
      <main>
        <p role="status">Opening control room…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <div className="brand">
          F<span>/</span> CONTROL ROOM
        </div>
        <h1>Staff access.</h1>
        <p>Sign in with an administrator account to manage demo content.</p>
        <form
          onSubmit={(e) => {
            const d = values(e);
            void run(async () => {
              const r = await api("/auth/login", "POST", d);
              setUser(r.user);
              if (r.user.role === "admin") await load();
            });
          }}
        >
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy}>Sign in</button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );
  if (user.role !== "admin")
    return (
      <main>
        <h1>Administrator access required.</h1>
        <p>Your account cannot manage content.</p>
        <button
          onClick={() =>
            void run(async () => {
              await api("/auth/logout", "POST");
              setUser(null);
            })
          }
        >
          Sign out
        </button>
      </main>
    );
  return (
    <>
      <header>
        <div className="brand">
          F<span>/</span> CONTROL ROOM
        </div>
        <div className="staff">
          {user.displayName}
          <span className="badge">DEMO</span>
          <button
            className="quiet"
            onClick={() =>
              void run(async () => {
                await api("/auth/logout", "POST");
                setUser(null);
              })
            }
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="shell">
        <aside>
          <p className="eyebrow">CONTENT OPERATIONS</p>
          {(
            ["sets", "cards", "packs", "moderation", "engagement"] as View[]
          ).map((v) => (
            <button
              key={v}
              className={view === v ? "selected" : ""}
              onClick={() => tab(v)}
            >
              {v}
              <span>
                {v === "sets"
                  ? sets.length
                  : v === "cards"
                    ? cards.length
                    : v === "packs"
                      ? packs.length
                      : v === "moderation"
                        ? subs.length
                        : "↗"}
              </span>
            </button>
          ))}
          <p className="eyebrow" style={{ marginTop: 28 }}>BUSINESS OPERATIONS</p>
          <a className="cr-link" href="/admin/control">KAM, Moment Studio, campaigns ↗</a>
          <p className="aside-note">
            Demo content • Solana devnet
            <br />
            All decisions are saved by the server.
          </p>
        </aside>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">FAZE COLLECTOR CARDS / STAFF</p>
              <h1>
                {view === "sets"
                  ? "Build the next drop."
                  : view === "cards"
                    ? "The card studio."
                    : view === "packs"
                      ? "Define the opening."
                      : view === "moderation"
                        ? "Keep the community clear."
                        : "Turn up the hype."}
              </h1>
            </div>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => void run(load)}
            >
              Refresh
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {view === "sets" && (
            <>
              <section className="editor">
                <h2>{editing ? "Edit set" : "Create a set"}</h2>
                <form
                  key={editing?.id ?? "new"}
                  onSubmit={(e) => {
                    const d = values(e);
                    void run(async () => {
                      await api(
                        editing ? `/admin/sets/${editing.id}` : "/admin/sets",
                        editing ? "PATCH" : "POST",
                        d,
                      );
                      setEditing(null);
                      await load();
                      setNotice(
                        "Set saved. Add cards and an active pack before publishing.",
                      );
                    });
                  }}
                >
                  <label>
                    Set name
                    <input
                      name="name"
                      defaultValue={editing?.name ?? ""}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      name="description"
                      defaultValue={editing?.description ?? ""}
                      maxLength={500}
                    />
                  </label>
                  <div className="actions">
                    <button disabled={busy}>Save set</button>
                    {editing && (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => setEditing(null)}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
              </section>
              <div className="grid">
                {sets.map((s) => (
                  <article key={s.id}>
                    <span className={`badge ${s.status}`}>{s.status}</span>
                    <h2>{s.name}</h2>
                    <p>{s.description}</p>
                    <p className="muted">
                      {cards.filter((c) => c.setId === s.id).length} cards ·{" "}
                      {packs.filter((p) => p.setId === s.id).length} packs
                    </p>
                    <div className="actions">
                      <button className="quiet" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                      <button
                        disabled={busy || s.status === "live"}
                        onClick={() =>
                          void run(async () => {
                            await api(`/admin/sets/${s.id}/publish`, "POST");
                            await load();
                            setNotice(
                              `${s.name} is published and available in the store.`,
                            );
                          })
                        }
                      >
                        Publish
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "cards" && (
            <>
              <section className="editor">
                <h2>{editing ? "Edit card" : "Create a card"}</h2>
                <form
                  key={editing?.id ?? "new"}
                  onSubmit={(e) => {
                    const d = values(e);
                    const body = {
                      ...d,
                      artUrl: art || String(d.artUrl),
                      basePower: Number(d.basePower),
                      maxSupply: d.maxSupply ? Number(d.maxSupply) : null,
                    };
                    if (editing) delete (body as any).setId;
                    void run(async () => {
                      await api(
                        editing ? `/admin/cards/${editing.id}` : "/admin/cards",
                        editing ? "PATCH" : "POST",
                        body,
                      );
                      setEditing(null);
                      setArt("");
                      await load();
                      setNotice("Card saved.");
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Set
                      <select
                        name="setId"
                        required
                        defaultValue={editing?.setId ?? sets[0]?.id}
                        disabled={!!editing}
                      >
                        {sets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Card name
                      <input
                        name="name"
                        defaultValue={editing?.name ?? ""}
                        required
                        maxLength={80}
                      />
                    </label>
                    <label>
                      FaZe member
                      <input
                        name="fazeMember"
                        defaultValue={editing?.fazeMember ?? ""}
                        required
                        maxLength={60}
                      />
                    </label>
                    <label>
                      Rarity
                      <select
                        name="rarity"
                        defaultValue={editing?.rarity ?? "common"}
                      >
                        {["common", "rare", "epic", "legendary"].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Base power
                      <input
                        name="basePower"
                        type="number"
                        min="0"
                        defaultValue={editing?.basePower ?? 20}
                        required
                      />
                    </label>
                    <label>
                      Maximum supply (blank = unlimited)
                      <input
                        name="maxSupply"
                        type="number"
                        min="1"
                        defaultValue={editing?.maxSupply ?? ""}
                      />
                    </label>
                  </div>
                  <label>
                    Art URL
                    <input
                      name="artUrl"
                      defaultValue={editing?.artUrl ?? ""}
                      placeholder="/demo-art/… or https://…"
                    />
                  </label>
                  <label>
                    Upload original or licensed art (PNG, JPEG, WebP · 2 MB)
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(e) =>
                        void run(() => upload(e.target.files?.[0]))
                      }
                    />
                  </label>
                  {art && <p className="success">Ready: {art}</p>}
                  <div className="actions">
                    <button disabled={busy || !sets.length}>Save card</button>
                    {editing && (
                      <button
                        className="quiet"
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setArt("");
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
              </section>
              <div className="grid cards">
                {cards.map((c) => (
                  <article key={c.id}>
                    {c.artUrl && (
                      <img
                        src={new URL(c.artUrl, API).toString()}
                        alt={c.name}
                      />
                    )}
                    <span className="badge">{c.rarity}</span>
                    <h2>{c.name}</h2>
                    <p>
                      {c.fazeMember} · Power {c.basePower}
                    </p>
                    <button
                      className="quiet"
                      onClick={() => {
                        setEditing(c);
                        setArt("");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit card
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "packs" && (
            <>
              <section className="editor">
                <h2>{editing ? "Edit pack" : "Create a pack"}</h2>
                <form
                  key={editing?.id ?? "new"}
                  onSubmit={(e) => {
                    const d = values(e);
                    const odds = Object.fromEntries(
                      ["common", "rare", "epic", "legendary"].map((r) => [
                        r,
                        Number(d[r]),
                      ]),
                    );
                    if (
                      Math.abs(
                        Object.values(odds).reduce((a, b) => a + b, 0) - 100,
                      ) > 1e-8
                    ) {
                      setError("Odds must total 100%.");
                      return;
                    }
                    const body: any = {
                      name: d.name,
                      priceCoins: Number(d.priceCoins),
                      cardsPerPack: Number(d.cardsPerPack),
                      odds,
                    };
                    if (editing) body.active = d.active === "on";
                    else body.setId = d.setId;
                    void run(async () => {
                      await api(
                        editing ? `/admin/packs/${editing.id}` : "/admin/packs",
                        editing ? "PATCH" : "POST",
                        body,
                      );
                      setEditing(null);
                      await load();
                      setNotice("Pack saved with server-validated odds.");
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Set
                      <select
                        name="setId"
                        defaultValue={editing?.setId ?? sets[0]?.id}
                        disabled={!!editing}
                      >
                        {sets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Pack name
                      <input
                        name="name"
                        defaultValue={editing?.name ?? ""}
                        required
                      />
                    </label>
                    <label>
                      Coin price
                      <input
                        type="number"
                        name="priceCoins"
                        min="1"
                        defaultValue={editing?.priceCoins ?? 100}
                        required
                      />
                    </label>
                    <label>
                      Cards per pack
                      <input
                        type="number"
                        name="cardsPerPack"
                        min="1"
                        max="20"
                        defaultValue={editing?.cardsPerPack ?? 5}
                        required
                      />
                    </label>
                    {["common", "rare", "epic", "legendary"].map((r, i) => (
                      <label key={r}>
                        {r} %
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          name={r}
                          defaultValue={editing?.odds[r] ?? [70, 20, 8, 2][i]}
                          required
                        />
                      </label>
                    ))}
                  </div>
                  {editing && (
                    <label className="check">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={editing.active}
                      />
                      Active in store when set is live
                    </label>
                  )}
                  <div className="actions">
                    <button disabled={busy || !sets.length}>Save pack</button>
                    {editing && (
                      <button
                        className="quiet"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
              </section>
              {packs.map((p) => (
                <article key={p.id} className="row">
                  <div>
                    <h2>{p.name}</h2>
                    <p>
                      {p.priceCoins} coins · {p.cardsPerPack} cards · odds v
                      {p.oddsVersion} · {p.active ? "active" : "inactive"}
                    </p>
                    <p className="muted">
                      {Object.entries(p.odds)
                        .map(([r, n]) => `${r} ${n}%`)
                        .join(" / ")}
                    </p>
                  </div>
                  <button className="quiet" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                </article>
              ))}
            </>
          )}
          {view === "moderation" && (
            <>
              <p className="intro">
                Automatic flags help review. Content stays pending until a staff
                decision.
              </p>
              {subs.length === 0 && (
                <section className="empty">
                  <h2>Queue clear.</h2>
                  <p>No pending submissions.</p>
                </section>
              )}
              {subs.map((s) => (
                <article key={s.id}>
                  <div className="row">
                    <span className="badge">{s.kind.replaceAll("_", " ")}</span>
                    <time>{new Date(s.createdAt).toLocaleString()}</time>
                  </div>
                  <pre>
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(s.payload).map(([k, v]) => [
                          k,
                          typeof v === "string" && v.length > 500
                            ? v.slice(0, 500) + "…"
                            : v,
                        ]),
                      ),
                      null,
                      2,
                    )}
                  </pre>
                  <p className="muted">
                    Flags:{" "}
                    {s.autoFlags.length
                      ? s.autoFlags.join(", ")
                      : "none / awaiting automatic scan"}
                  </p>
                  <div className="actions">
                    {(["approve", "reject"] as const).map((decision) => (
                      <button
                        key={decision}
                        className={decision === "reject" ? "quiet" : ""}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/admin/moderation/${s.id}`, "POST", {
                              decision,
                            });
                            await load();
                            setNotice(
                              `Submission ${decision === "approve" ? "approved" : "rejected"}.`,
                            );
                          })
                        }
                      >
                        {decision}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </>
          )}
          {view === "engagement" && (
            <section className="editor">
              <span className="badge">SIMULATED • DEMO ONLY</span>
              <h2>Create a moment.</h2>
              <p>
                Queue an engagement spike. The worker records a simulated event
                and raises this member’s card hype, capped at 100.
              </p>
              <form
                onSubmit={(e) => {
                  const d = values(e);
                  void run(async () => {
                    const r = await api("/admin/engagement/spike", "POST", d);
                    setNotice(
                      `Spike queued (${r.jobId}). Keep the worker running, then refresh the fan leaderboard.`,
                    );
                  });
                }}
              >
                <label>
                  FaZe member
                  <select name="fazeMember">
                    {[...new Set(cards.map((c) => c.fazeMember))]
                      .sort()
                      .map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                  </select>
                </label>
                <button disabled={busy || !cards.length}>
                  Trigger demo spike ↗
                </button>
              </form>
            </section>
          )}
        </main>
      </div>
      <footer>FAZE COLLECTOR CARDS · STAFF CONSOLE · DEMO ENVIRONMENT</footer>
    </>
  );
}
