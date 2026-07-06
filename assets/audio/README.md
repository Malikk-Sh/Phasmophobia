# Audio asset pack

The game can now use realistic audio files instead of the procedural WebAudio fallback.

1. Put `.ogg`, `.mp3`, or `.wav` files in this folder or subfolders.
2. Add them to `manifest.json` under the matching sample key.
3. Keep every sound licensed for redistribution in this repository. Good safe choices are CC0/public-domain packs or sounds created for the project.

Example:

```json
{
  "samples": {
    "player.step.indoor": ["assets/audio/foley/step-wood-01.ogg", "assets/audio/foley/step-wood-02.ogg"],
    "door.creak": ["assets/audio/house/door-creak-01.ogg"],
    "ghost.whisper": ["assets/audio/ghost/whisper-01.ogg"],
    "ambience.rain": ["assets/audio/ambience/rain-loop.ogg"]
  }
}
```

## Downloading a starter CC0 pack

Run this from the repository root to download vetted CC0 packs from OpenGameArt, select matching files, and rewrite `manifest.json` automatically:

```bash
node scripts/fetch-audio-pack.mjs
```

The downloader writes selected files into `assets/audio/cc0/` and records source/license notes in `assets/audio/cc0/LICENSES.md`. If your environment blocks downloads, use the source links in `SOURCES.md` and fill the manifest manually.

Supported keys:

- `ambience.indoor`, `ambience.basement`, `ambience.rain`, `ambience.wind`
- `player.step.indoor`, `player.step.outdoor`, `player.heartbeat`, `player.jumpscare`, `player.death`
- `ghost.step`, `ghost.whisper`, `ghost.spiritResponse`, `ghost.event`, `ghost.event.lady`, `ghost.event.shadow`, `ghost.event.hangman`, `ghost.bansheeWail`, `ghost.writing`
- `door.creak`, `door.slam`, `switch.click`, `breaker.on`, `breaker.off`, `house.creak`, `radio.crackle`
- `prop.whoosh`, `prop.impact.hard`, `prop.impact.soft`
- `item.crucifixBurn`, `item.smudge`, `item.saltPour`, `item.pills`, `item.cameraPlace`
- `hunt.start`, `hunt.end`, `weather.thunder`, `ui.click`

If a key is absent or a file fails to load, the procedural sound for that action is used automatically.
