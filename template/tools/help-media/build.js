#!/usr/bin/env node
// tools/help-media/build.js
// Turns Playwright's capture output into the assets the Help Library serves.
//
//   tools/help-media/.out/<slug>/<name>.webm   ->  web/public/help-media/<slug>/<name>.mp4
//   tools/help-media/.out/<slug>/<name>.png    ->  web/public/help-media/<slug>/<name>.png
//   tools/help-media/.out/<slug>/<name>.json   ->  optional { trimStart, trimEnd, format }
//
// A .png whose stem also has a .webm is that clip's poster. A .png on its own
// is a still.
//
// There is no system ffmpeg on the devbox and no sudo to install one, and
// Playwright's bundled binary only has the png and libvpx encoders, so this
// package carries its own via ffmpeg-static. There is no ffprobe in that
// package either, which is why duration is read out of ffmpeg's own stderr.

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const REPO = path.resolve(__dirname, '..', '..');
const IN   = path.join(__dirname, '.out');
const OUT  = path.join(REPO, 'web', 'public', 'help-media');

const CLIP_MAX_BYTES    = 1_500_000;
const CLIP_MAX_SECONDS  = 25;
const STILL_MAX_BYTES   = 200_000;
const STILL_MAX_WIDTH   = 1024;

const problems = [];
const fail = (msg) => problems.push(msg);

/** A disqualified artifact must not survive the run, so removal has to be safe
 *  to call even if the file was never written (ffmpeg failed before producing
 *  it) or was already removed. */
function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch { /* already gone, fine */ }
}

/** A sidecar is the one file in this pipeline a human hand-edits, so a
 *  malformed one (trailing comma, unescaped quote) is a realistic input, not
 *  a bug. Report it by name and keep going rather than crash the whole run. */
function readSidecar(sidePath) {
  if (!fs.existsSync(sidePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(sidePath, 'utf8'));
  } catch (err) {
    fail(`${path.relative(REPO, sidePath)} is not valid JSON: ${err.message}`);
    return {};
  }
}

function run(args) {
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

/** ffmpeg with no output exits non-zero and prints "Duration: 00:00:12.34". */
function durationSeconds(file) {
  const r = run(['-hide_banner', '-i', file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function transcodeClip(src, dest, sidecar) {
  const trim = [];
  if (typeof sidecar.trimStart === 'number') trim.push('-ss', String(sidecar.trimStart));
  if (typeof sidecar.trimEnd   === 'number') trim.push('-to', String(sidecar.trimEnd));
  const r = run([
    '-y', '-hide_banner', '-loglevel', 'error',
    ...trim, '-i', src,
    '-vf', 'scale=1280:-2,fps=24',
    '-c:v', 'libx264', '-crf', '28', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    dest,
  ]);
  if (r.status !== 0) {
    fail(`ffmpeg failed on ${path.relative(REPO, src)}:\n${r.stderr}`);
    unlinkQuiet(dest);
    return false;
  }
  return true;
}

/**
 * A poster is the frame a clip shows before it plays, and the ONLY thing a
 * reduced-motion reader ever sees, so it keeps the clip's 1280 width and is
 * always JPEG, a 1280-wide PNG screenshot of this UI lands well over the
 * 200kB gate, and there is no useful transparency in a screen recording.
 * A standalone still is not competing with a video frame, so it downscales
 * to 1024 and stays PNG unless its sidecar asks for JPEG.
 */
function transcodeStill(src, dest, { isPoster, format }) {
  const width = isPoster ? 1280 : STILL_MAX_WIDTH;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1',
  ];
  if (format === 'jpg') args.push('-q:v', '4');
  args.push(dest);
  const r = run(args);
  if (r.status !== 0) {
    fail(`ffmpeg failed on ${path.relative(REPO, src)}:\n${r.stderr}`);
    unlinkQuiet(dest);
    return false;
  }
  return true;
}

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`[help-media] nothing to build: ${path.relative(REPO, IN)} does not exist. Run \`npm run help:capture\` in web/ first.`);
    process.exit(1);
  }

  const slugs = fs.readdirSync(IN, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'raw')   // `raw` is Playwright's own outputDir
    .map(d => d.name);

  let clips = 0, stills = 0;

  for (const slug of slugs) {
    const dir     = path.join(IN, slug);
    const outDir  = path.join(OUT, slug);
    fs.mkdirSync(outDir, { recursive: true });
    const files   = fs.readdirSync(dir);
    const webms   = files.filter(f => f.endsWith('.webm'));
    const stems   = new Set(webms.map(f => f.replace(/\.webm$/, '')));

    for (const webm of webms) {
      const stem     = webm.replace(/\.webm$/, '');
      const sidePath = path.join(dir, `${stem}.json`);
      // Snapshot BEFORE readSidecar: it reports a malformed sidecar through
      // fail(), so a snapshot taken after it already contains that problem and
      // the "must not survive" rule below can never see it. The clip would then
      // ship with its trim silently unapplied.
      const before   = problems.length;
      const sidecar  = readSidecar(sidePath);
      const dest     = path.join(outDir, `${stem}.mp4`);

      if (!transcodeClip(path.join(dir, webm), dest, sidecar)) continue;

      const bytes  = fs.statSync(dest).size;
      const secs   = durationSeconds(dest);
      if (bytes > CLIP_MAX_BYTES) {
        fail(`${slug}/${stem}.mp4 is ${bytes} bytes, over the ${CLIP_MAX_BYTES} limit, shorten the clip or trim it with a sidecar`);
      }
      if (secs === null) {
        fail(`${slug}/${stem}.mp4 has no readable duration`);
      } else if (secs > CLIP_MAX_SECONDS) {
        fail(`${slug}/${stem}.mp4 runs ${secs.toFixed(1)}s, over the ${CLIP_MAX_SECONDS}s limit, trim it with a sidecar`);
      }
      if (!fs.existsSync(path.join(dir, `${stem}.png`))) {
        fail(`${slug}/${stem}.webm has no ${stem}.png poster, every clip needs one`);
      }
      // Uniform rule: any problem recorded against this artifact means it must
      // not survive the run, even if e.g. only the poster was missing and the
      // video itself transcoded fine. A gone file turns a quiet oversized clip
      // into a loud, unmissable "does not exist" from help-audit's Check 8.
      if (problems.length > before) { unlinkQuiet(dest); continue; }
      clips++;
      console.log(`clip  ${slug}/${stem}.mp4  ${(bytes / 1000).toFixed(0)}kB  ${secs === null ? '?' : secs.toFixed(1)}s`);
    }

    for (const png of files.filter(f => f.endsWith('.png'))) {
      const stem    = png.replace(/\.png$/, '');
      const sidePath= path.join(dir, `${stem}.json`);
      const before  = problems.length;
      const sidecar = readSidecar(sidePath);
      const isPoster= stems.has(stem);
      const format  = isPoster || sidecar.format === 'jpg' ? 'jpg' : 'png';
      const dest    = path.join(outDir, `${stem}.${format}`);

      if (!transcodeStill(path.join(dir, png), dest, { isPoster, format })) continue;

      const bytes = fs.statSync(dest).size;
      if (bytes > STILL_MAX_BYTES) {
        fail(isPoster
          ? `${slug}/${stem}.jpg is ${bytes} bytes, over the ${STILL_MAX_BYTES} limit, capture a simpler poster frame`
          : `${slug}/${stem}.${format} is ${bytes} bytes, over the ${STILL_MAX_BYTES} limit, add {"format":"jpg"} to ${slug}/${stem}.json and rebuild`);
        unlinkQuiet(dest);
        continue;
      }
      // Same rule as the clips: a malformed sidecar means `format` was never
      // read, so a still that asked for jpg silently stayed png. Delete it
      // rather than let a wrong-format file pass the size gate.
      if (problems.length > before) { unlinkQuiet(dest); continue; }
      stills++;
      console.log(`${isPoster ? 'poster' : 'still '} ${slug}/${stem}.${format}  ${(bytes / 1000).toFixed(0)}kB`);
    }
  }

  console.log(`\n[help-media] ${clips} clips, ${stills} stills -> ${path.relative(REPO, OUT)}`);
  if (problems.length) {
    console.error(`\n[help-media] ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

main();
