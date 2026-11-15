// Builds the demo card data from the finished card faces in /assets/assets (title, date, lore, edition and frame are baked
// into the images). Run from the repo root: node content/seed/demo-cards/build.mjs
// Facts are only what is printed on the cards or in content/archive; voiceScript is a hype read of the same facts (no invented claims).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "..", "..", "assets", "assets");
const SET = { og: "d0000000-0000-4000-8000-000000000001", creators: "d0000000-0000-4000-8000-000000000002", esports: "d0000000-0000-4000-8000-000000000003", stream: "d0000000-0000-4000-8000-000000000004" };
const id = (n) => `d0000000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;

// tier: the frame on the artwork. rarity: the closest tier the app knows (common/rare/epic/legendary).
// silver -> rare, mythic/legendary -> legendary, epic -> epic.
const CARDS = [
  { n: 2001, file: "where it all began.png", name: "Where It All Began", set: "og", tier: "mythic", rarity: "legendary", date: "May 30, 2010",
    lore: "FaZe uploads its first YouTube video, FaZe Sniping Intro. The beginning of the clan's history.",
    voice: "[gasps] Oh, you are JOKING. Where It All Began! Do you know what this is? May, twenty ten. Three mates, one sniper rifle, a brand new YouTube channel... and they just hit upload. FaZe Sniping Intro. Nobody had a clue what was coming. And now? Every trophy, every house, every million subscribers, it all starts right here. [laughs] Mythic. Number one of a thousand. Honestly, I'm getting goosebumps." },
  { n: 2002, file: "the first illcam.png", name: "The First ILLCAM", set: "og", tier: "legendary", rarity: "legendary", date: "June 2, 2010",
    lore: "The first episode of the trickshot series that helped define FaZe's identity.",
    voice: "[excited] Oh, that's a proper one, that. The First ILLCAM! June the second, twenty ten, just three days after the channel opens, and it's a killcam compilation. Sounds simple, right? But that one idea carries the channel for four whole years. Forty nine episodes! One format. And it all kicked off right here. Legendary, mate." },
  { n: 2003, file: "faze_card_003_the_million_club_mythic_5x7.png", name: "The Million Club", set: "og", tier: "mythic", rarity: "legendary", date: "October 8, 2012",
    lore: "FaZe celebrates one million subscribers with an 11-minute-plus teamtage, a milestone that cemented FaZe as a global force in gaming.",
    voice: "[excited] Oh, we are in the CLUB now! October the eighth, twenty twelve. One million subscribers. And how do they celebrate? An eleven minute teamtage, obviously. That's the moment a trickshot crew from YouTube turns into a global force. The Million Club. [laughs] Mythic, number three of a thousand. Welcome, lads." },
  { n: 2004, file: "faze_card_004_welcome_to_faze_house_legendary_5x7.png", name: "Welcome to the FaZe House", set: "creators", tier: "legendary", rarity: "legendary", date: "December 2014",
    lore: "The New York creator house turns FaZe into more than a trickshot channel. This is where the group's shared lifestyle content takes shape.",
    voice: "[excited] Right, come on in! December, twenty fourteen, and the New York creator house opens its doors. Suddenly FaZe isn't just a trickshot channel anymore. It's late nights, shared jokes, content that feels like family. This is where the whole lifestyle side of FaZe takes shape. Welcome to the FaZe House. Legendary!" },
  { n: 2005, file: "I love it .png", name: "I Love It!", set: "creators", tier: "epic", rarity: "epic", date: "August 28, 2015",
    lore: "An old-school FaZe meme featuring Adapt and Rain, a nostalgia-fueled moment fans still remember.",
    voice: "[laughs] Oh no, not THIS one! August the twenty eighth, twenty fifteen. Adapt and Rain. One daft little meme that fans still shout back at their screens to this day. I love it! Pure old school FaZe, absolutely dripping in nostalgia. If you were there... you remember. Epic!" },
  { n: 2006, file: "the hot ones challenge.png", name: "The Hot Ones Challenge", set: "creators", tier: "silver", rarity: "rare", date: "March 2015",
    lore: "FaZe takes on the viral Hot Ones challenge at the FaZe House, creating a fan-favorite group video packed with chaos and reactions.",
    voice: "[laughs] Oh, the Hot Ones Challenge! March, twenty fifteen, the whole crew round the FaZe House, a load of seriously hot wings, and zero mercy. It's chaos. Sweating, coughing, reactions you genuinely cannot unsee. One point three million views and counting! Silver edition, number thirteen of ten thousand. Absolutely mental." },
  { n: 2007, file: "the impossible death run .png", name: "The Impossible Deathrun", set: "esports", tier: "epic", rarity: "epic", date: "December 2018",
    lore: "FaZe Cizzorz's nine-level Fortnite Deathrun becomes a viral community challenge. Suezhoo completes it in 7:45 on December 21.",
    voice: "[excited] Right, this one's nuts. December, twenty eighteen. Cizzorz builds a nine level Fortnite deathrun, and the community completely loses the plot. Then Suezhoo goes and clears it in seven minutes, forty five seconds, on the twenty first. Impossible? Apparently not! Epic." },
  { n: 2008, file: "the elimination squad.png", name: "The 57-Elimination Squad", set: "esports", tier: "legendary", rarity: "legendary", date: "September 22, 2018",
    lore: "FaZe's Tfue and Cloak, alongside ZexRow and Kreo, briefly set a PC squads elimination record of 57 in Fortnite.",
    voice: "[gasps] Fifty seven! FIFTY SEVEN eliminations in one match! September the twenty second, twenty eighteen. Tfue and Cloak, with ZexRow and Kreo, briefly set a PC squads elimination record in Fortnite. That's not a game, that's a statement. [laughs] Legendary." },
  { n: 2009, file: "call of duty world cup.png", name: "Call of Duty World Champions", set: "stream", tier: "legendary", rarity: "legendary", date: "August 22, 2021",
    lore: "Atlanta FaZe defeats Toronto Ultra 5–3 to win the Call of Duty League Championship.",
    voice: "[excited] Atlanta FaZe, world champions! August the twenty second, twenty twenty one. Toronto Ultra in the final, five three, and FaZe lift the Call of Duty League Championship. In the game where it all began! Honestly, unreal. Legendary." },
  { n: 2010, file: "the antrep major.png", name: "The Antwerp Major", set: "esports", tier: "mythic", rarity: "legendary", date: "May 22, 2022",
    lore: "FaZe defeats NAVI 2–0 to win its first CS:GO Major, becoming the first international roster to win one.",
    voice: "[excited] Antwerp has gone RED! May the twenty second, twenty twenty two. FaZe beat Natus Vincere, two nil, to win their first CS:GO Major, and they're the first international roster to ever do it. History, right there. The Antwerp Major. Mythic!" },
  { n: 2011, file: "million dollar grand slam.png", name: "The Million-Dollar Grand Slam", set: "esports", tier: "mythic", rarity: "legendary", date: "March 26, 2023",
    lore: "FaZe beats Cloud9 3–1 to complete Intel Grand Slam IV and earn its $1 million award, cementing FaZe's legacy in Counter-Strike.",
    voice: "[gasps] A million dollars! March the twenty sixth, twenty twenty three. FaZe beat Cloud9, three one, to complete Intel Grand Slam Four, and they pocket a million dollars for it. A legacy cemented in Counter-Strike. [excited] The Million Dollar Grand Slam. Mythic!" },
  { n: 2012, file: "the faze reboot.png", name: "The FaZe Reboot", set: "creators", tier: "legendary", rarity: "legendary", date: "April 27, 2024",
    lore: "The new creator lineup is unveiled. GameSquare later reports more than 350 million estimated impressions during the relaunch.",
    voice: "[excited] New faces, same FaZe! April the twenty seventh, twenty twenty four. A brand new creator lineup gets unveiled, and GameSquare later reports over three hundred and fifty million estimated impressions around the relaunch. The FaZe Reboot. Legendary!" },
  { n: 2013, file: "the subathon finale.png", name: "The Subathon Finale", set: "creators", tier: "legendary", rarity: "legendary", date: "September 30, 2024",
    lore: "Banks gets emotional at the end of a month-long stream. GameSquare reports more than 2.2 billion minutes watched across the subathon.",
    voice: "[excited] A whole month of streaming, and it's finally over! September the thirtieth, twenty twenty four, and Banks gets properly emotional at the end of it. GameSquare reports over two point two BILLION minutes watched across the subathon. Billion! With a B! [laughs] The Subathon Finale. Legendary." },
];

// One unique, grounded description per catalog card (ids d0000000-...-0000000010NN).
const LORE = {
  1001: "May 2010: three friends start a Call of Duty trickshotting crew on YouTube. Everything FaZe became starts here.",
  1002: "May 22, 2022: FaZe beats Natus Vincere 2–0 for its first Major, the first mixed-nationality roster to win a CS:GO Major.",
  1003: "FaZe beats Astralis 2–0 in the final to take the $500K ELEAGUE CS:GO Premier, the headline trophy of the year.",
  1004: "A trimmed roster, a new creator class and a fresh start. The 2024 reboot rewrites who FaZe is.",
  1005: "Four million subscribers strong. The community that grew with every upload celebrates the milestone together.",
  1006: "July 2019: a one-day New York pop-up draws fans who camp out to meet the squad, until the police shut it down.",
  1007: "Another ESL Pro League season, another night of high-stakes Counter-Strike for the FaZe roster.",
  1008: "On the channel's first anniversary the community-made Historic montage drops: a love letter to the fans who clip and cut.",
  1009: "The house crew's best jokes, fails and reactions in a single compilation. FaZe at its goofiest.",
  1010: "Revisiting the house where so many early FaZe videos took shape. Old walls, big memories.",
  1011: "Adapt bets Tfue $1,000 that he can't land a trickshot. One shot, real money, zero chill.",
  1012: "August 22, 2021: Atlanta FaZe beats Toronto Ultra 5–3 to win the Call of Duty League Championship.",
  1013: "May 2024: Silky arrives with a new Twitch-native class, signed one per day across four days.",
  1014: "When one of the world's biggest advertisers came calling, FaZe's creators brought the laughs.",
  1015: "June 2010: the first killcam compilation drops three days after the channel opens, and a four-year subscriber engine is born.",
  1016: "A month-long subathon ends, and Banks gets emotional as more than 2.2 billion minutes watched are counted.",
  1017: "July 2022: FaZe beats Natus Vincere 3–2 for $400K, the third leg of the Intel Grand Slam.",
  1018: "Episode 30 of the killcam series that taught a generation to rewind and replay the impossible shot.",
  1019: "A title from 2017's hot streak, when FaZe closed the year among the top teams in CS:GO.",
  1020: "A merch collaboration honoring Juice WRLD's Legends Never Die, where music and gaming culture meet.",
  1021: "March 26, 2023: FaZe wins ESL Pro League Season 17 and completes the Intel Grand Slam.",
  1022: "Call of Duty was FaZe's first love, and the competitive roster carries that trickshot spirit onto the big stage.",
  1023: "Round two of the house crew's jokes, fails and reactions. Sequels this chaotic are rare.",
  1024: "The first trickshot of 2017 lands. The clan built on impossible shots keeps the tradition alive.",
  1025: "May 2019: Nick NICKMERCS Kolcheff signs with FaZe, a headline pickup for the creator side.",
  1026: "The clan steps onto the public markets, a long way from a three-person trickshot channel on YouTube.",
  1027: "May 2024: JasonTheWeen joins the new class of Twitch-native creators, with a Miami content house to call home.",
  1028: "Where the creators lived, filmed and became a family: the house that changed what FaZe could be.",
  1029: "October 2012: one million subscribers and an 11-minute teamtage, a milestone that put FaZe on the map.",
  1030: "Win Katowice, win Cologne, win Pro League: FaZe completes Intel Grand Slam IV for $1 million.",
  1031: "Episode 38 is the series peak, with more than 5.4 million views, the most-watched ILLCAMS ever.",
  1032: "A Premier League champion signs a content and apparel deal with a trickshotting clan from Long Island.",
  1033: "February 2022: FaZe sweeps G2 3–0 at IEM Katowice and starts a Grand Slam run.",
  1034: "The very first upload: three players, one sniper rifle and no plan beyond the next clip.",
  1035: "One of FaZe's longest-running brand partnerships, the fuel behind years of clips and challenges.",
  1036: "Behind the handles: how FaZe members ended up with the names fans know today.",
  1037: "The house becomes one giant game of hide and seek, with loud creators and nowhere safe to hide.",
  1038: "April 2020: Swagg is surprised with the offer live on stream and brings his Warzone Nuke Squad along.",
  1039: "May 2024: Plaqueboymax is the first signing of the new class, kicking off four signings in four days.",
  1040: "A blank white room, no distractions, and a challenge that makes every small reaction louder.",
};

// Card Clash tags (the game's existing tag vocabulary) so the finished faces are playable. A card wins a round by how well its tags match the prompt.
const GAME_TAGS = {
  2001: ["precision", "clutch", "surprise"], 2002: ["precision", "surprise", "clutch"], 2003: ["celebration", "teamwork", "creators"],
  2004: ["creators", "collab", "teamwork"], 2005: ["comedy", "reaction", "creators"], 2006: ["comedy", "reaction", "collab"],
  2007: ["resilience", "precision", "surprise"], 2008: ["clutch", "precision", "teamwork"], 2009: ["clutch", "teamwork", "celebration"],
  2010: ["clutch", "teamwork", "celebration"], 2011: ["clutch", "teamwork", "celebration"], 2012: ["comeback", "resilience", "creators"],
  2013: ["comeback", "resilience", "celebration"],
};
mkdirSync(path.join(here, "art"), { recursive: true });
const out = { demo: true, sets: { stream: { id: SET.stream, name: "Stream Moments", description: "Limited cards you can collect live from a stream when chat goes wild. Demo collectibles." } }, special: [], lore: Object.fromEntries(Object.entries(LORE).map(([k, v]) => [id(Number(k)), v])) };
for (const c of CARDS) {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dest = path.join(here, "art", `${slug}.webp`);
  const info = await sharp(path.join(SRC, c.file)).webp({ quality: 84, effort: 5 }).toFile(dest);
  out.special.push({ id: id(c.n), tags: GAME_TAGS[c.n], setId: SET[c.set], name: c.name, tier: c.tier, rarity: c.rarity, date: c.date, lore: c.lore, voiceScript: c.voice, art: `art/${slug}.webp`, width: info.width, height: info.height, bytes: info.size });
}
out.announcer = { "hype-alert": "[excited] Chat is going absolutely mental! A limited card just dropped. Grab it now!" };
// Narration for the catalog Epic cards too, so every good pull (epic and up) gets the full treatment.
const EXTRA = {
  1003: "[excited] Ooh, that's a trophy! FaZe beat Astralis, two nil, in the final, and take the five hundred thousand dollar ELEAGUE CS:GO Premier. The headline win of the year. Epic pull, that.",
  1004: "[excited] Fresh start! A trimmed down roster, a new creator class, and a whole new chapter. The twenty twenty four reboot rewrites who FaZe is. Epic pull.",
  1017: "[excited] Cologne, July twenty twenty two! FaZe beat Natus Vincere, three two, for four hundred thousand dollars, and that's the third leg of the Intel Grand Slam. Epic stuff.",
  1029: "[excited] One million subscribers! October, twenty twelve, an eleven minute teamtage, and a milestone that puts FaZe on the map. Epic pull, mate.",
  1030: "[excited] Win Katowice. Win Cologne. Win Pro League. FaZe complete Intel Grand Slam Four for a cool million dollars. Epic pull!",
};
out.extraVoices = Object.entries(EXTRA).map(([n, text]) => ({ id: id(Number(n)), text }));
out.sfx = {
  "party-silver": { text: "Short fun celebration: a party horn blast, a confetti pop and a small happy crowd cheering, bright and punchy", seconds: 2.5 },
  "party-gold": { text: "Big triumphant celebration: an air horn blast, a confetti cannon pop and a huge stadium crowd roaring and cheering, epic and exciting", seconds: 3.5 },
};
writeFileSync(path.join(here, "demo-cards.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`${out.special.length} special cards, ${Object.keys(out.lore).length} lore lines; webp total ${(out.special.reduce((n, s) => n + s.bytes, 0) / 1024 / 1024).toFixed(1)} MB`);
