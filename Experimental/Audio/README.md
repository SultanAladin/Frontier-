# Frontier Audio Lab (experimental)

A dependency-free browser editor for preparing game audio before it is moved into Project Zero.

## Run

Serve the repository root (do not open the HTML as `file://`, because the manifest is fetched):

```sh
python3 -m http.server 8080 --bind 0.0.0.0
```

Open `http://localhost:8080/Experimental/Audio/`.

## Workflow

1. Select a production slot, then choose its matching natural recording, or use **Import** / drag-and-drop.
2. Audition non-destructive gain, pitch, pan, high/low-pass filters, compressor, and reverb.
3. Use **Save preset** to download a `.frontier-audio.json` parameter sidecar.
4. Use **Export WAV** for a normalized 48 kHz, 16-bit PCM game master.
5. Place approved masters under `Content/Audio/<Category>/` and set each asset's `path` in `Content/Audio/manifest.json`.

Audio selected from the user's machine stays in browser memory. The editor never uploads or overwrites a source file.

## Keyboard controls

- `Space`: play / pause
- `L`: loop
- `R`: reset the signal chain
- `E`: export the current selection
- `/`: focus search
- `Ctrl/Cmd + Z`: undo

## Asset status

The manifest intentionally starts with production **slots**, not fake synthesized noise. Non-speech sound generation is not available in this workspace, so no asset is represented as an AI-generated natural recording when it is not. Add approved generated or field-recorded masters to the content folders; the editor itself is ready to audition and export them.
