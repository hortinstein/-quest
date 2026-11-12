import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

// Keep accents, but never allow names to introduce path separators or '..'.
export function capturePath(character, now) {
  const name = character.slug.normalize('NFC').replace(/[^\p{L}\p{N}-]/gu, '_');
  const folder = `${name}_${character.region}`;
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `screenshots/${folder}/${date}_${name}_LEVEL${character.profile.level}.png`;
}

export async function capturePage(page, character) {
  const response = await page.goto(character.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`Armory returned HTTP ${response?.status() ?? 'unknown'}.`);
  await page.locator('.CharacterHeader').waitFor({ timeout: 60_000 });
  await page.locator('.CharacterProfile-gear--bottom').waitFor({ timeout: 60_000 });
  const renderedLevel = await page.evaluate(() => window.characterProfileInitialState?.character?.level);
  if (renderedLevel !== character.profile.level) throw new Error('Armory level changed between lookup and capture.');
  await page.locator('.SummaryCharacter .Spinner').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('#profile-page-background-style'), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.SummaryCharacter-render img, .CharacterProfile img')];
    return images.some((image) => image.complete && image.naturalWidth > 0 && Number(getComputedStyle(image).opacity) > 0.9);
  }, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Item icons are CSS backgrounds, so document.images alone misses them.
    const urls = [...document.querySelectorAll('.CharacterProfile .GameIcon-icon, .ProfilePage > .Pane-bg')]
      .map((node) => getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1])
      .filter(Boolean);
    await Promise.all(urls.map((url) => new Promise((done, fail) => {
      const image = new Image();
      const timer = setTimeout(() => fail(new Error('An armory image timed out.')), 20_000);
      image.onload = () => { clearTimeout(timer); done(); };
      image.onerror = () => { clearTimeout(timer); fail(new Error('An armory image failed to load.')); };
      image.src = url;
    })));
  });
  // The model uses WebGL and the page animates equipment into place.
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: '.SummaryCharacter-qualityControl, .SummaryCharacter .flex.flex-items-center.flex-justify-space { visibility: hidden !important; }' });
  await page.mouse.move(0, 0);
  const clip = await page.evaluate(() => {
    const header = document.querySelector('.CharacterHeader').getBoundingClientRect();
    const profile = document.querySelector('.CharacterProfile').getBoundingClientRect();
    const items = [...document.querySelectorAll('.CharacterProfile-item, .CharacterProfile-itemDetails')]
      .map((node) => node.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
    if (!items.length) throw new Error('No equipment slots found.');
    const x = Math.max(0, Math.floor(Math.min(header.left, profile.left, ...items.map((r) => r.left)) - 12));
    const y = Math.max(0, Math.floor(header.top + scrollY - 12));
    const right = Math.min(innerWidth, Math.ceil(Math.max(header.right, profile.right, ...items.map((r) => r.right)) + 12));
    const bottom = Math.ceil(Math.max(...items.map((r) => r.bottom)) + scrollY + 12);
    return { x, y, width: right - x, height: bottom - y };
  });
  if (clip.width < 500 || clip.height < 500) throw new Error('Unexpected armory capture bounds.');
  return page.screenshot({ type: 'png', clip, animations: 'disabled', timeout: 30_000 });
}

export function createGearCapturer(siteRoot) {
  let browser;
  return {
    async capture(character, now) {
      browser ??= await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
      const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(60_000);
      try {
        const buffer = await capturePage(page, character);
        let path = capturePath(character, now);
        await mkdir(dirname(resolve(siteRoot, path)), { recursive: true });
        try {
          await writeFile(resolve(siteRoot, path), buffer, { flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          // A character can revisit a level on the same day; preserve both images.
          path = path.replace(/\.png$/, `_${now.getTime()}.png`);
          await writeFile(resolve(siteRoot, path), buffer, { flag: 'wx' });
        }
        return path;
      } finally {
        await page.close();
      }
    },
    async close() { await browser?.close(); },
  };
}
