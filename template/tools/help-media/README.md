# help-media

Transcodes Help Library screen captures into the files `web/public/help-media/` serves.

## Why this is its own package

`ffmpeg-static` unpacks a ~75MB binary. As a `web/` devDependency it would land in
every CI `npm ci` and in the Docker build, which copies all of `web/`. Nothing in the
app imports it, so it lives here and is installed by hand.

## Install once

```bash
cd tools/help-media && npm install
```

`node_modules/` and `.out/` here are gitignored.

## Use

```bash
cd web && npm run help:capture     # writes tools/help-media/.out/<slug>/*
cd .. && npm run help:media        # writes web/public/help-media/<slug>/*
```

## Inputs

| File | Meaning |
|---|---|
| `.out/<slug>/<name>.webm` | A clip. Becomes `<name>.mp4`. |
| `.out/<slug>/<name>.png` with a matching `.webm` | That clip's poster. Always emitted as `<name>.jpg` at 1280 wide. |
| `.out/<slug>/<name>.png` with no `.webm` | A still. |
| `.out/<slug>/<name>.json` | Optional `{ "trimStart": 1.5, "trimEnd": 14, "format": "jpg" }`. |

## Gates

A clip must be at most 1,500,000 bytes and 25 seconds. A poster or still must be at
most 200,000 bytes. Posters keep the clip's 1280 width and are always JPEG, because a
poster is what a reduced-motion reader sees instead of the video. Standalone stills
downscale to 1024 wide and stay PNG unless a sidecar asks for JPEG. Over a limit the
build exits non-zero and names the file and the fix.

## Encoder settings

`scale=1280:-2,fps=24`, `libx264 -crf 28 -preset slow`, `yuv420p`, `+faststart`, no
audio track. 720p, silent, and progressive-downloadable, which is what a muted
looping help clip needs and nothing more.
