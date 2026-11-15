// A small FaZe speech bubble that pops out of a card and says, in a few words, why the moment matters.
export function shortLore(lore: string | undefined, max = 110): string {
  const text = (lore ?? '').trim();
  if (!text) return '';
  const first = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

export function FazeBubble({ text }: { text: string }) {
  return <div className="faze-bubble" role="note"><span className="faze-bubble-tag" aria-hidden="true">F</span><p>{text}</p></div>;
}
