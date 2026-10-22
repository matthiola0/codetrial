import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RUNTIME_CONFIG,
  launchChromium,
  FAKE_SPEECH_CAPTURE,
  startStaticServer,
} from "./source.js";
import { LANGUAGE_KEY } from "../../web/lib.js";

// C is offered only once the judge proves the problem function-style, so a
// compiled runner has to be on for the requested tab to exist at all.
const CE_RUNTIME_CONFIG = DEFAULT_RUNTIME_CONFIG.replace(
  "ENABLED = false",
  "ENABLED = true",
).replace('BASE_URL = ""', 'BASE_URL = "https://godbolt.org"');
let browser = null;
let server = null;
let base = "";

before(async () => {
  browser = await launchChromium({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      FAKE_SPEECH_CAPTURE,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  if (!browser) return;
  ({ server, base } = await startStaticServer({
    runtimeConfig: CE_RUNTIME_CONFIG,
  }));
});

after(async () => {
  await browser?.close();
  await new Promise((closed) => (server ? server.close(closed) : closed()));
});

/// Joins through the preflight and answers the token request's body.
async function joinAndCaptureToken(page) {
  await page.route("**/api/token", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Token request captured by the test." }),
    }),
  );
  await page.locator("#audio-heard").click();
  await page.locator("#camera-skip").click();
  await page.waitForFunction(
    () => !document.querySelector("#audio-check-join").disabled,
  );
  const sent = page.waitForRequest((request) =>
    request.url().endsWith("/api/token"),
  );
  await page.locator("#audio-check-join").click();
  return sent;
}

test("the token names a requested C whose judge loads after Start", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  let releaseJudge = () => {};
  try {
    const held = new Promise((resolve) => {
      releaseJudge = resolve;
    });
    await page.route("**/judges/*.json", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(
      `${base}/interview.html?problem=chargeback-pair-match&language=c`,
      { waitUntil: "domcontentloaded" },
    );
    let tokenSent = false;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/token")) tokenSent = true;
    });
    const request = joinAndCaptureToken(page);
    await page.waitForFunction(
      () => document.querySelector("#audio-check").hidden,
    );
    assert.equal(tokenSent, false, "the token waits for the judge");
    releaseJudge();
    assert.equal((await request).postDataJSON().language, "c");
    // Remembered for the next interview to preselect.
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), LANGUAGE_KEY),
      "c",
    );
  } finally {
    releaseJudge();
    await page.close();
  }
});

test("a whiteboard token carries no language", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await page.goto(
      `${base}/interview.html?problem=chargeback-pair-match&mode=whiteboard`,
      { waitUntil: "domcontentloaded" },
    );
    const body = (await joinAndCaptureToken(page)).postDataJSON();
    assert.equal(Object.hasOwn(body, "language"), false);
  } finally {
    await page.close();
  }
});
