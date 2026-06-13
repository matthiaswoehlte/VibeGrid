/**
 * scripts/debug-subdivision.mjs
 *
 * Plan 9c — Trigger-Subdivision Bug-Diagnose (v3).
 *
 * Bug-Report: „Trigger Speed 1, 2, 4, 8, 16 hat null Wirkung."
 *
 * v3 fügt zur v2 (UI-walk + bundle-probe + aria-pressed-flip) noch
 * RENDERER-INSTRUMENTATION hinzu:
 *
 *   In `lib/renderer/loop.ts` ist temporär ein `[SUB-DEBUG]` console.log
 *   eingebaut (vor dem RenderContext-Aufbau), der bei jedem rgb-split-Clip
 *   mit 2 % Wahrscheinlichkeit pro Frame Folgendes loggt:
 *     - triggerSubdivision   (clip-state, direkt aus dem Store)
 *     - subdivision           (fallback-bereinigt)
 *     - multiplier            (SUBDIVISION_MULTIPLIERS-Lookup)
 *     - time                  (deps.getCurrentTime())
 *     - beatPhase             (phase.phase)
 *     - subdividedBeatPhase   (phase.phase * multiplier % 1)
 *
 * v3-Ablauf:
 *   1. Studio öffnen (Stub-Cookie, Middleware passt durch).
 *   2. FX-Tab links öffnen → RGB Split auf FX-Lane droppen.
 *   3. Clip selektieren → SubdivisionPicker erscheint im Inspector.
 *   4. Subdivision 1× klicken, 3 s warten, SUB-DEBUG-Logs sammeln.
 *   5. Subdivision 4× klicken, 3 s warten, SUB-DEBUG-Logs sammeln.
 *   6. Vergleich:
 *        sub=1× erwartet: multiplier=1, subdividedBeatPhase==beatPhase
 *        sub=4× erwartet: multiplier=4, subdividedBeatPhase==(beatPhase*4)%1
 *
 * EINSCHRÄNKUNG: Ohne sync-audio MediaRef (id-prefix `sync-`) bleibt
 *   `engine.currentTime` auf 0 → `beatPhase` konstant 0 → subdividedBeatPhase
 *   auch 0. Wir können damit immer noch verifizieren:
 *     - dass der Renderer den aktualisierten `clip.triggerSubdivision` SIEHT
 *       (Feld `triggerSubdivision` ändert sich nach Click)
 *     - dass `multiplier` korrekt aus der Map gelesen wird (1 → 4)
 *     - dass die SUB-DEBUG-Logs überhaupt feuern (Renderer-Loop läuft)
 *   Falls der Renderer NICHT loggt nach Drop → Renderer-Loop oder Clip-Filter
 *   ist das Problem. Falls multiplier sich nicht ändert obwohl
 *   triggerSubdivision flippt → State-propagation-bug.
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.VIBEGRID_URL ?? 'http://localhost:3001';
const STUB_COOKIE = {
  name: 'vibegrid.session_token',
  value: 'e2e-stub-session-cookie-not-a-real-session',
  domain: 'localhost',
  path: '/',
  expires: Math.floor(Date.now() / 1000) + 60 * 60,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax'
};

function log(label, data) {
  // eslint-disable-next-line no-console
  console.log(`\n[${label}]`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([STUB_COOKIE]);

  const page = await context.newPage();

  // Collect SUB-DEBUG logs in a side-channel
  const subDebugLogs = [];
  page.on('pageerror', (e) => log('page-error', e.message));
  const gateLogs = [];
  page.on('console', (m) => {
    const text = m.text();
    if (text.startsWith('[SUB-DEBUG]') || text.startsWith('[SUB-DEBUG-GATE]')) {
      const bucket = text.startsWith('[SUB-DEBUG-GATE]') ? gateLogs : subDebugLogs;
      Promise.all(m.args().slice(1).map((a) => a.jsonValue().catch(() => null)))
        .then((vals) => {
          bucket.push(vals[0] ?? text);
        });
    } else if (m.type() === 'error') {
      log('console-error', text);
    }
  });

  // ─── 1. Open studio ──────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  if (page.url().includes('/login')) {
    log('FATAL', 'Login wall — stub cookie did not pass middleware.');
    await browser.close();
    return;
  }
  log('navigate', { url: page.url() });

  // VibeGrid vs SceneFlow tab: SceneFlow has a "Story"/"SceneFlow" toggle at
  // the top. If we're in SceneFlow mode, the FX library button won't exist.
  // The button to switch BACK to VibeGrid is usually in the TopBar. Try
  // clicking any "VibeGrid" labeled tab if present.
  const vibeTabCandidates = await page.getByRole('button', { name: /vibegrid|studio|editor/i }).all();
  log('mode-tab-candidates', { count: vibeTabCandidates.length });

  // ─── 2. Open FX tab in left sidebar ──────────────────────────────────────
  const fxTabBtn = page.getByRole('button', { name: /^fx$/i }).first();
  const fxTabVisible = await fxTabBtn.isVisible().catch(() => false);
  log('fx-tab-visible', fxTabVisible);
  if (!fxTabVisible) {
    log('FATAL', 'FX tab not visible — likely SceneFlow mode. Aborting.');
    await browser.close();
    return;
  }
  await fxTabBtn.click();
  await page.waitForTimeout(300);

  // ─── 3. Locate RGB Split in FX library ───────────────────────────────────
  const rgbSplit = page.locator('aside li', { hasText: 'RGB Split' }).first();
  const rgbSplitVisible = await rgbSplit.isVisible();
  log('rgb-split-found', rgbSplitVisible);
  if (!rgbSplitVisible) {
    log('FATAL', 'RGB Split FX entry not found in library.');
    await browser.close();
    return;
  }

  // ─── 4. Drop RGB Split onto FX track ─────────────────────────────────────
  const fxLane = page.locator('[data-track-kind="fx"]').first();
  const fxLaneVisible = await fxLane.isVisible();
  log('fx-lane-found', fxLaneVisible);

  // Drop at x:0 so the clip starts at beat 0 → active at the (paused, t=0)
  // playhead. Otherwise getActiveFxClips skips it and we never reach the
  // subdivision math. The renderer reads `beats` from `time*bpm/60`; with
  // engine.currentTime=0 (no sync-audio loaded), beats=0 always.
  await rgbSplit.dragTo(fxLane, { targetPosition: { x: 0, y: 16 } });
  await page.waitForTimeout(500);

  const clipBlockCount = await fxLane.locator('button, [role="button"], [data-clip-id]').count();
  log('clip-blocks-on-fx-lane', clipBlockCount);
  if (clipBlockCount === 0) {
    log('FATAL', 'Drop did not produce a clip.');
    await browser.close();
    return;
  }

  // ─── 5. Click the new clip → Inspector + SubdivisionPicker appears ───────
  const clipBlock = fxLane.locator('button, [role="button"], [data-clip-id]').first();
  await clipBlock.click();
  await page.waitForTimeout(300);

  const subdivPicker = page.getByRole('group', { name: 'Trigger Subdivision' });
  const pickerVisible = await subdivPicker.isVisible().catch(() => false);
  log('subdivision-picker-visible', pickerVisible);
  if (!pickerVisible) {
    log('FATAL', 'Clip selected but SubdivisionPicker not rendered.');
    await browser.close();
    return;
  }

  // ─── 6. Cycle: 1× → 3s capture → 4× → 3s capture ─────────────────────────
  async function clickSubdivAndCapture(label, waitMs = 3000) {
    const before = subDebugLogs.length;
    const btn = subdivPicker.locator('button', { hasText: label }).first();
    await btn.click();
    await page.waitForTimeout(waitMs);
    const captured = subDebugLogs.slice(before);
    return captured;
  }

  log('step', 'Click 1× + capture 3s of SUB-DEBUG');
  const at1x = await clickSubdivAndCapture('1×', 3000);

  log('step', 'Click 4× + capture 3s of SUB-DEBUG');
  const at4x = await clickSubdivAndCapture('4×', 3000);

  log('step', 'Click 16× + capture 3s of SUB-DEBUG');
  const at16x = await clickSubdivAndCapture('16×', 3000);

  // ─── 7. Report ──────────────────────────────────────────────────────────
  log('sub-debug-total-count', { total: subDebugLogs.length, at1x: at1x.length, at4x: at4x.length, at16x: at16x.length });
  log('sub-debug-at-1x', at1x.slice(0, 5));
  log('sub-debug-at-4x', at4x.slice(0, 5));
  log('sub-debug-at-16x', at16x.slice(0, 5));

  log('GATE-log-total', gateLogs.length);
  log('GATE-log-sample', gateLogs.slice(0, 5));

  // Analysis: do we see the multiplier change?
  const mults1x = [...new Set(at1x.map((l) => l && l.multiplier).filter((v) => v !== undefined))];
  const mults4x = [...new Set(at4x.map((l) => l && l.multiplier).filter((v) => v !== undefined))];
  const mults16x = [...new Set(at16x.map((l) => l && l.multiplier).filter((v) => v !== undefined))];
  log('multipliers-observed', { at1x: mults1x, at4x: mults4x, at16x: mults16x });

  const timeChanged = at1x.length > 0 && at4x.length > 0 &&
    new Set([...at1x, ...at4x].map((l) => l && l.time).filter(Boolean)).size > 1;
  log('time-advancing', timeChanged);

  let verdict;
  if (subDebugLogs.length === 0 && gateLogs.length > 0) {
    const blocked = gateLogs.every((g) => g && g.willContinue);
    verdict =
      'CAUGHT IT: ' + gateLogs.length + ' SUB-DEBUG-GATE logs fired, but 0 ' +
      'SUB-DEBUG logs reached the subdivision math. willContinue=' + blocked + '. ' +
      'Bedeutung: RGB Split ist in IMAGE_MODIFYING_KINDS und wird stillschweigend ' +
      'continued, wenn KEIN Bild auf der Image-Lane liegt. Das ist die wahrscheinliche ' +
      'Ursache des „kein Effekt"-Berichts: ohne Bild rendert RGB Split überhaupt nicht, ' +
      'egal welche Subdivision gewählt ist.';
  } else if (subDebugLogs.length === 0) {
    verdict =
      'NO SUB-DEBUG logs at all → either: (a) Renderer-Loop läuft nicht im ' +
      'idle Studio, (b) Clip-Filter (IMAGE_MODIFYING_KINDS gate?) blockt rgb-' +
      'split ohne Image, (c) Bundle-Hot-Reload greift nicht. Live-Smoke nötig.';
  } else if (mults4x.includes(4) && mults1x.includes(1)) {
    verdict =
      'RENDERER LIEST UPDATED STATE: multiplier flippt korrekt 1 → 4 → 16. ' +
      'Bug ist NICHT im Renderer-Math. ' +
      (timeChanged
        ? 'Time advanced — visuelle Speed-Differenz sollte sichtbar sein → ' +
          'Hypothese D (Visual zu schnell zum Erkennen) bestätigt sich.'
        : 'Time blieb 0 (kein Audio geladen) → kann visuelle Differenz nicht ' +
          'verifizieren, brauche sync-audio MediaRef. Aber: STATE-WIRE FUNKTIONIERT.');
  } else if (mults1x.length === 0 && mults4x.length === 0) {
    verdict =
      'SUB-DEBUG logs feuerten, aber keine multiplier-Werte capturable — ' +
      'Console-arg-Serialisierung gebrochen. Roh-Output siehe sub-debug-at-* ' +
      'oben.';
  } else {
    verdict =
      'MULTIPLIER STAGNIERT trotz Click — Renderer sieht NICHT den updated ' +
      'state. Möglich: stale closure in createRenderer, oder timeline-' +
      'Snapshot in getTimelineState ist frozen. Das wäre der Bug.';
  }
  log('VERDICT', verdict);

  await browser.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('FATAL', e);
  process.exit(1);
});
