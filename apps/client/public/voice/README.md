# Pack-reveal audio

What plays, with no buttons:
- A **good pull** (silver or gold face, any epic or legendary) triggers a short **party sound** (`party-silver.mp3` for silver/epic, `party-gold.mp3` for gold/legendary), then the card's **story** (`<card id>.mp3`) plays by itself.
- When chat spikes on `/watch`, the popup opens with a short call-out (`hype-alert.mp3`); collecting the card plays the gold party, then its story.
- Tapping Next, closing, or leaving stops the audio.

How it is made (ElevenLabs, generated once, offline, so the API key never reaches the browser):
- **Voice:** a custom UK "FaZe Hype Announcer" created with ElevenLabs Voice Design from a written persona (young London lad, cool slightly raspy,
  esports hype announcer with real laughs and gasps), spoken with the `eleven_v3` model so tags like `[laughs]` and `[gasps]` come through.
  `voice.json` records the exact voice, model, settings and persona used.
- **Scripts:** `voiceScript` in `content/seed/demo-cards/demo-cards.json` (also stored in `cards.voice_script`), written to sound like a mate reacting live.
  They only restate facts printed on the card or in the FaZe archive.
- **Party sounds:** generated with ElevenLabs Sound Effects from the prompts in `demo-cards.json` (`sfx`).
- **Regenerate / change:** `node content/seed/demo-cards/voice/generate-elevenlabs.mjs` (needs `ELEVEN_LABS_API_KEY` in `.env`; only changed clips are regenerated).
  An earlier open-source version (Piper, CC0 voice) is in git history, and `generate.py` still produces it.

Swapping the narrator later: only `apps/client/lib/voice.ts` plays audio. Replace the files here, or set `NEXT_PUBLIC_VOICE_BASE` to any host serving the same filenames.
