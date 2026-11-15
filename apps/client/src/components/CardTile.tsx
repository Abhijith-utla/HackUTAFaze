import type { Card } from "@faze/shared";
export function CardTile({ card, serial, delay = 0 }: { card: Card; serial?: number; delay?: number }) {
  return (
    <div className={`card reveal ${card.rarity}`} style={{ animationDelay: `${delay}ms` }}>
      <div style={{ aspectRatio: "3/4", background: "#0f0f12", borderRadius: 8, overflow: "hidden" }}>
        {card.artUrl && <img src={card.artUrl} alt={card.name} width="100%" />}
      </div>
      <strong>{card.name}</strong>
      <div className="mute">{card.fazeMember} · {card.rarity}{serial ? ` · #${serial}` : ""}</div>
      {card.demo && <span className="badge">demo</span>}
    </div>
  );
}
