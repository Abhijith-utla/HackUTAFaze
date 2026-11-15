# Card narrations

`<card id>.mp3`: a short hype read of each special card's legacy, played when you tap a special card in the pack reveal.

- **Voice:** Piper TTS (MIT) with the `en_US-joe-medium` voice, dataset license **CC0**. Generated offline; no external service.
- **Script:** the `voiceScript` of each card in `content/seed/demo-cards/demo-cards.json` (also stored in `cards.voice_script`).
  It only restates facts printed on the card or in the FaZe archive.
- **Regenerate / change the voice:** `content/seed/demo-cards/voice/generate.py`.
- **Swapping in an agent later:** the client only calls `playCardVoice(cardId)` in `apps/client/lib/voice.ts`. Point `NEXT_PUBLIC_VOICE_BASE` at any
  host that serves `<card id>.mp3`, or replace that one function with a call to the agent. Nothing else needs to change.
