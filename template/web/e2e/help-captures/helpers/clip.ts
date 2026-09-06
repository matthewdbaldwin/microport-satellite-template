// web/e2e/help-captures/helpers/clip.ts
// Recording helpers shared by every *.capture.ts spec.
//
// Pacing is the point. A test written for speed produces an unwatchable
// clip: elements appear and change in one frame with no pointer travel
// between them. moveTo/clickAt/dragTo always travel in steps and always
// pause afterwards, so a viewer can follow what happened.
//
// Playwright records one video per browser context, and the file is only
// final once the page is closed. saveClip() therefore closes the page, it
// is always the last statement in a capture.

import fs from 'fs';
import path from 'path';
import { test as base, type Page } from '@playwright/test';
import { installCursor } from './cursor';
import { OUT_ROOT } from './paths';

// Re-exported so specs and the interface Task 11/12 rely on are unchanged:
// the shared source of truth now lives in paths.ts, alongside RAW_DIR, which
// playwright.help-capture.config.ts imports for its own outputDir.
export { OUT_ROOT };

export interface Sidecar {
  /** Seconds to cut from the head, e.g. the app's first paint. */
  trimStart?: number;
  /** Absolute end time in seconds. */
  trimEnd?: number;
  /** Encode this still as JPEG instead of PNG, for a heavy screenshot. */
  format?: 'png' | 'jpg';
}

function slugDir(slug: string): string {
  const dir = path.join(OUT_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The Playwright `test` object with the cursor overlay always installed. */
export const test = base.extend<{ cursor: void }>({
  cursor: [async ({ page }, use) => {
    await page.addInitScript(installCursor);
    await use();
  }, { auto: true }],
});

export { expect } from '@playwright/test';

/** A readable beat. Every helper ends with one. */
export async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms);
}

async function centreOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}, is it visible?`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function moveTo(page: Page, selector: string, opts: { steps?: number } = {}): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  const { x, y } = await centreOf(page, selector);
  await page.mouse.move(x, y, { steps: opts.steps ?? 24 });
  await settle(page, 250);
}

export async function clickAt(page: Page, selector: string): Promise<void> {
  await moveTo(page, selector);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await settle(page);
}

/**
 * Pick a <select> option with a visible cursor. A raw page.selectOption()
 * never dispatches a mousemove, so the cursor overlay never moves and the
 * value flips on screen with no visible cause. This moves the cursor onto
 * the control first (clickAt), then sets the value.
 *
 * Pass a string to pick by option value: this validates the value against
 * the control's real <option> list first and throws naming what's actually
 * there, which is what an operator needs to see rather than a silent
 * no-op if the demo data doesn't produce the expected value. Pass
 * `{ index }` to pick positionally instead, where no such name exists to
 * validate against (e.g. "whatever the second option is").
 */
export async function moveThenSelect(
  page: Page,
  selector: string,
  value: string | { index: number },
): Promise<void> {
  await clickAt(page, selector);
  if (typeof value !== 'string') {
    await page.selectOption(selector, value);
    await settle(page, 900);
    return;
  }
  const options = await page.locator(`${selector} option`).allTextContents();
  const values  = await page.locator(`${selector} option`).evaluateAll(els => els.map(e => (e as HTMLOptionElement).value));
  const index   = values.indexOf(value);
  if (index === -1) throw new Error(`${selector} has no option "${value}" (has: ${values.join(', ')} / ${options.join(', ')})`);
  await page.selectOption(selector, value);
  await settle(page, 900);
}

// There is deliberately no drag helper. The pipeline kanban uses native HTML5
// drag and drop (LeadsBoard.tsx: draggable + onDragStart/onDragOver/onDrop),
// which Chromium does not synthesise from a real pointer, so a mouse-driven
// drag would move the pointer and nothing else. Captures that need a stage
// change use the card's stage menu instead, which is a real click path and
// records cleanly. See Task 11.

/** A still, or a poster when `name` matches a clip recorded in the same run. */
export async function still(page: Page, slug: string, name: string, selector?: string): Promise<void> {
  const file = path.join(slugDir(slug), `${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path: file });
  else await page.screenshot({ path: file });
}

/** A poster: a still that shares its name with a clip recorded in the same run. */
export async function poster(page: Page, slug: string, name: string): Promise<void> {
  await still(page, slug, name);
}

export async function saveClip(page: Page, slug: string, name: string, sidecar?: Sidecar): Promise<void> {
  const video = page.video();
  if (!video) throw new Error('no video on this page, run with playwright.help-capture.config.ts');
  if (sidecar) {
    fs.writeFileSync(path.join(slugDir(slug), `${name}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  }
  await page.close();                                        // finalizes the recording
  await video.saveAs(path.join(slugDir(slug), `${name}.webm`));
  await video.delete();                                      // drop the copy in outputDir
}
