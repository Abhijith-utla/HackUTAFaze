// Demo opponent identity: a random-looking player "from somewhere in the world". Deterministic from the match id so a reload shows the
// same opponent. In this demo the opponent is ALWAYS the computer, and the UI says so; this only decides the flavour text.
export type Opponent = { handle: string; city: string; country: string; flag: string; ping: number };

const PLACES: [string, string, string][] = [
  ['Tokyo', 'Japan', '🇯🇵'], ['Seoul', 'South Korea', '🇰🇷'], ['São Paulo', 'Brazil', '🇧🇷'], ['Lagos', 'Nigeria', '🇳🇬'], ['Berlin', 'Germany', '🇩🇪'],
  ['Mumbai', 'India', '🇮🇳'], ['Mexico City', 'Mexico', '🇲🇽'], ['Sydney', 'Australia', '🇦🇺'], ['Toronto', 'Canada', '🇨🇦'], ['London', 'United Kingdom', '🇬🇧'],
  ['Cairo', 'Egypt', '🇪🇬'], ['Reykjavík', 'Iceland', '🇮🇸'], ['Jakarta', 'Indonesia', '🇮🇩'], ['Stockholm', 'Sweden', '🇸🇪'], ['Buenos Aires', 'Argentina', '🇦🇷'],
  ['Manila', 'Philippines', '🇵🇭'], ['Istanbul', 'Türkiye', '🇹🇷'], ['Nairobi', 'Kenya', '🇰🇪'], ['Warsaw', 'Poland', '🇵🇱'], ['Singapore', 'Singapore', '🇸🇬'],
  ['Dubai', 'UAE', '🇦🇪'], ['Paris', 'France', '🇫🇷'], ['Lima', 'Peru', '🇵🇪'], ['Auckland', 'New Zealand', '🇳🇿'],
];
const HANDLES = ['ShadowKitsune', 'NovaPulse', 'ClutchKing_99', 'EchoViper', 'PixelWolf', 'TurboNomad', 'GhostRelay', 'NeonSamurai', 'ZeroLag', 'IronMantis',
  'SkyHawk_X', 'VoltRunner', 'CrimsonFlick', 'LunarByte', 'RapidFox', 'StaticDrift', 'BlazeOrbit', 'QuietStorm', 'FrostByte', 'AceOfSpades_7', 'NightOwl_gg', 'HyperLoop'];

/** FNV-1a 32-bit. */
export function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function opponentFor(seed: string): Opponent {
  const h = hash(seed);
  const [city, country, flag] = PLACES[h % PLACES.length];
  return { handle: HANDLES[(h >>> 8) % HANDLES.length], city, country, flag, ping: 18 + ((h >>> 16) % 90) };
}

/** Places for the "searching the world" animation (the real opponent is appended last by the caller). */
export const allPlaces = () => PLACES.map(([city, country, flag]) => ({ city, country, flag }));
