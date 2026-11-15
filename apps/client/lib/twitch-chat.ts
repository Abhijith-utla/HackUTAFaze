// Read-only Twitch chat over the official anonymous IRC-over-WebSocket endpoint (the documented "justinfan" login: no account,
// no token, cannot send). Used only to measure chat energy; the visible chat is Twitch's own embedded chat.
export type ChatMessage = { user: string; text: string; emotes: number };
export type ChatStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** Parses one raw IRC line. Returns a chat message, 'ping' (must be answered with PONG), or null for everything else. */
export function parseIrcLine(line: string): ChatMessage | 'ping' | null {
  if (line.startsWith('PING')) return 'ping';
  let rest = line, tags = '';
  if (rest.startsWith('@')) { const sp = rest.indexOf(' '); tags = rest.slice(1, sp); rest = rest.slice(sp + 1); }
  const m = /^:([^!\s]+)![^\s]* PRIVMSG #\S+ :(.*)$/.exec(rest);
  if (!m) return null;
  let text = m[2];
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1];
  const emotesTag = tags.split(';').find((t) => t.startsWith('emotes='))?.slice(7) ?? '';
  // emotes=25:0-4,6-10/1902:12-16 -> one entry per occurrence (ranges), not per emote id
  const emotes = emotesTag ? emotesTag.split('/').reduce((n, part) => n + (part.split(':')[1]?.split(',').length ?? 0), 0) : 0;
  return { user: m[1], text, emotes };
}

/** Connects (and reconnects with backoff) until the returned function is called. */
export function connectChat(channel: string, onMessage: (m: ChatMessage) => void, onStatus?: (s: ChatStatus) => void): () => void {
  const chan = channel.toLowerCase().replace(/[^a-z0-9_]/g, '');
  let ws: WebSocket | null = null, stopped = false, attempt = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    onStatus?.(attempt ? 'reconnecting' : 'connecting');
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    ws.onopen = () => {
      ws!.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws!.send('PASS SCHMOOPIIE');
      ws!.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws!.send(`JOIN #${chan}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (!line) continue;
        if (line.includes(' 366 ')) { attempt = 0; onStatus?.('connected'); } // end of NAMES: joined
        const r = parseIrcLine(line);
        if (r === 'ping') ws?.send('PONG :tmi.twitch.tv');
        else if (r) onMessage(r);
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      onStatus?.('reconnecting');
      timer = setTimeout(open, Math.min(15000, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => { stopped = true; clearTimeout(timer); onStatus?.('closed'); try { ws?.close(); } catch { /* already closed */ } };
}
