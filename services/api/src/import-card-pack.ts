// Import the supplied Chain Reaction archive directly into Postgres, without extracting images.
// Dry-run by default. Existing card ids, instances, trades and pack configurations are preserved.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeArt } from './art-store.js';
import { pool } from './db.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const catalogPath = path.join(root, 'content/seed/catalog.json');
const zipPath = process.argv[2];
if (!zipPath) throw new Error('Usage: tsx src/import-card-pack.ts <archive.zip> [--apply]');
const apply = process.argv.includes('--apply');
const rarity = { bronze: 'common', silver: 'rare', elite: 'epic', legendary: 'legendary' } as const;
type SourceCard = { id: string; title: string; rarity: keyof typeof rarity; image: string; era: string; lore: string; source_visual: string };
type Archive = { cards: SourceCard[]; images: Record<string, string> };
// ZIP content is data only. Never execute archive files or extract paths onto disk.
const python = `import zipfile,json,base64,sys,posixpath
with zipfile.ZipFile(sys.argv[1]) as z:
 if len(z.infolist())>100: raise ValueError('Too many archive entries')
 if len({i.filename for i in z.infolist()})!=len(z.infolist()): raise ValueError('Duplicate archive paths')
 if any(i.file_size>4*1024*1024 for i in z.infolist()): raise ValueError('Oversized archive entry')
 manifest=json.loads(z.read('cards.json'))
 cards=manifest['cards']
 if len(cards)!=40: raise ValueError('Expected 40 cards')
 images={}
 for c in cards:
  name=c['image']
  if posixpath.basename(name)!=name or not name.endswith('.png'): raise ValueError('Invalid image name')
  data=z.read('cards/'+name)
  if not 24<=len(data)<=2*1024*1024 or data[:8]!=b'\\x89PNG\\r\\n\\x1a\\n': raise ValueError('Invalid PNG')
  images[name]=base64.b64encode(data).decode('ascii')
 print(json.dumps({'cards':cards,'images':images}))`;

async function main() {
  const archive = JSON.parse(execFileSync('python', ['-c', python, path.resolve(zipPath)], { maxBuffer: 40 * 1024 * 1024, windowsHide: true }).toString()) as Archive;
  if (new Set(archive.cards.map(c => c.id)).size !== 40 || Object.keys(archive.images).length !== 40) throw new Error('Expected 40 unique cards and images');
  if (archive.cards.some(c => !(c.rarity in rarity) || !c.title || !c.era)) throw new Error('Invalid card metadata');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (catalog.cards.length !== 40) throw new Error('Expected the existing 40-card demo catalog');
  const sets = [...new Set<string>(catalog.cards.map((c: any) => c.setId))].sort();
  const groups = sets.map(id => catalog.cards.filter((c: any) => c.setId === id).sort((a: any, b: any) => a.id.localeCompare(b.id)));
  const incoming = sets.map((_, n) => archive.cards.filter((_, i) => i % sets.length === n));
  if (groups.some((g, i) => g.length !== incoming[i].length)) throw new Error('Set sizes do not match replacement plan');
  const bindings: { card: any; source: SourceCard }[] = groups.flatMap((g, n) => g.map((card: any, i: number) => ({ card, source: incoming[n][i] })));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', cards: bindings.length, tiers: rarity, distribution: incoming.map((g, i) => ({ set: sets[i], cards: g.length, rarities: [...new Set(g.map(c => rarity[c.rarity]))] })) }));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query('SELECT * FROM cards ORDER BY id FOR UPDATE');
    if (current.rows.length !== 40 || current.rows.some(r => !catalog.cards.some((c: any) => c.id === r.id))) throw new Error('Database catalog differs from expected 40 cards');
    const ownership = async () => (await db.query("SELECT md5(coalesce(string_agg(row_to_json(i)::text, ',' ORDER BY id), '')) AS hash FROM card_instances i")).rows[0].hash;
    const before = await ownership();
    if (!apply) { await db.query('ROLLBACK'); return; }
    await mkdir(path.join(root, '.data/card-replacement'), { recursive: true });
    await writeFile(path.join(root, `.data/card-replacement/before-${Date.now()}.json`), JSON.stringify({ cards: current.rows, catalog }, null, 2));
    for (const { card, source } of bindings) {
      const bytes = Buffer.from(archive.images[source.image], 'base64');
      const art = await storeArt(db, { mime: 'image/png', bytes, demo: true });
      const power = { common: 25, rare: 45, epic: 65, legendary: 85 }[rarity[source.rarity]];
      await db.query('UPDATE cards SET name=$2, faze_member=$3, rarity=$4, art_url=$5, base_power=$6, demo=true WHERE id=$1', [card.id, source.title, 'FaZe Clan', rarity[source.rarity], art.url, power]);
      Object.assign(card, { name: source.title, fazeMember: 'FaZe Clan', rarity: rarity[source.rarity], artUrl: art.url, basePower: power, demo: true, sourceCard: source });
      const stored = await db.query('SELECT bytes FROM card_art WHERE id=$1', [art.id]);
      if (createHash('sha256').update(stored.rows[0].bytes).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Stored image hash mismatch');
    }
    if (await ownership() !== before) throw new Error('Card instances changed during import; rolling back');
    await db.query('COMMIT');
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    console.log('Imported and hash-verified 40 database artworks; ownership unchanged. Seed catalog updated.');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Import failed'); process.exitCode = 1; }).finally(() => pool.end());
