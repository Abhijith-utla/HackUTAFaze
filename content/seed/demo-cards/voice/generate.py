"""Regenerates the card narrations (apps/client/public/voice/<card id>.mp3) from each card's voiceScript.

Engine: Piper (MIT, offline TTS). Voice: en_US-joe-medium (CC0). Swap by changing VOICE or replacing this script entirely.
Setup (throwaway env):  uv venv /tmp/piper --python 3.12 && uv pip install --python /tmp/piper/bin/python piper-tts
Voice files: https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US  (check each voice's MODEL_CARD license first;
some, e.g. ryan and hfc_male, are CC BY-NC-SA = non-commercial).
Run from the repo root:  /tmp/piper/bin/python content/seed/demo-cards/voice/generate.py <path to .onnx voice>
Needs ffmpeg with libmp3lame.
"""
import json, subprocess, sys, tempfile, wave
from pathlib import Path
from piper import PiperVoice, SynthesisConfig

root = Path(__file__).resolve().parents[4]
voice_path = sys.argv[1] if len(sys.argv) > 1 else "voices/en_US-joe-medium.onnx"
voice = PiperVoice.load(voice_path)
cards = json.loads((root / "content/seed/demo-cards/demo-cards.json").read_text())["special"]
out = root / "apps/client/public/voice"
out.mkdir(parents=True, exist_ok=True)
cfg = SynthesisConfig(length_scale=0.92, noise_scale=0.8, noise_w_scale=0.9)  # a little faster and livelier than default
for c in cards:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "v.wav"
        with wave.open(str(wav), "wb") as w:
            voice.synthesize_wav(c["voiceScript"], w, syn_config=cfg)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                        "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "56k", str(out / f"{c['id']}.mp3")], check=True)
    print("wrote", c["name"])
