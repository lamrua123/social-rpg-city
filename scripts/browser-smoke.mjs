import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.KINDRED_BASE_URL ?? 'http://127.0.0.1:5199';
const chromePath = process.env.KINDRED_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ['--no-sandbox'] });
const contexts = [];
const errors = [];

async function context(width, height, isMobile = false) {
  const browserContext = await browser.newContext({ viewport: { width, height }, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1 });
  contexts.push(browserContext);
  const page = await browserContext.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  return { context: browserContext, page };
}

async function enter(page, nickname, avatar) {
  await page.getByLabel('What should we call you?').fill(nickname);
  if (avatar) await page.getByRole('radio', { name: `Choose ${avatar}` }).click();
  await page.getByRole('button', { name: 'Enter the city' }).click();
  await page.getByRole('button', { name: 'Open chat history' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.room-meta').getByText(/in town/).waitFor({ state: 'visible', timeout: 10_000 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await mkdir('artifacts/qa', { recursive: true });
  const mika = await context(1440, 900);
  await mika.page.screenshot({ path: 'artifacts/qa/landing-desktop.png' });
  await enter(mika.page, 'Mika', 'Moss');

  const june = await context(1280, 800);
  await enter(june.page, 'June', 'Juniper');
  await mika.page.getByRole('button', { name: 'Open chat history' }).click();
  await june.page.getByRole('button', { name: 'Open chat history' }).click();
  await mika.page.getByText('June', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await june.page.getByText('Mika', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await mika.page.getByRole('button', { name: 'Close chat history' }).click();
  await june.page.getByRole('button', { name: 'Close chat history' }).click();
  await mika.page.screenshot({ path: 'artifacts/qa/town-desktop.png' });

  await june.page.getByRole('button', { name: /Ask Mika to chat/ }).click();
  await mika.page.getByRole('heading', { name: /June/ }).filter({ hasText: 'wants' }).waitFor({ state: 'visible', timeout: 8_000 }).catch(async () => {
    await mika.page.getByText('June', { exact: false }).filter({ hasText: 'wants to talk' }).waitFor({ state: 'visible', timeout: 5_000 });
  });
  await mika.page.getByRole('button', { name: 'Accept' }).click();
  await mika.page.getByLabel('Write a message').waitFor({ state: 'visible', timeout: 8_000 });
  await june.page.getByLabel('Write a message').waitFor({ state: 'visible', timeout: 8_000 });
  const input = mika.page.getByLabel('Write a message');
  assert.equal(await mika.page.locator('#chat-message').count(), 1, 'there should be only one chat input');
  const positionBeforeTyping = await mika.page.locator('.player-map-pin').getAttribute('transform');
  await input.pressSequentially('wasd');
  await sleep(350);
  assert.equal(await mika.page.locator('.player-map-pin').getAttribute('transform'), positionBeforeTyping, 'typing movement keys in chat must not move the character');
  await input.fill('Meet me by the fountain.');
  await input.press('Enter');
  await june.page.getByText('Meet me by the fountain.', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });

  const ari = await context(1180, 820);
  await enter(ari.page, 'Ari', 'Cloud');
  await ari.page.getByRole('button', { name: /Ask to join/ }).click();
  await mika.page.getByRole('button', { name: 'Accept Ari' }).waitFor({ state: 'visible', timeout: 8_000 });
  await mika.page.getByRole('button', { name: 'Accept Ari' }).click();
  await ari.page.getByLabel('Write a message').waitFor({ state: 'visible', timeout: 8_000 });
  await ari.page.getByLabel('Write a message').fill('There is room for everyone.');
  await ari.page.getByLabel('Write a message').press('Enter');
  await mika.page.getByText('There is room for everyone.', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await june.page.getByText('There is room for everyone.', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await mika.page.screenshot({ path: 'artifacts/qa/group-chat-desktop.png' });
  await mika.page.getByRole('button', { name: 'Close chat history' }).click();
  const quickComposer = mika.page.getByLabel('Write a message');
  await quickComposer.waitFor({ state: 'visible' });
  assert.equal(await mika.page.locator('#chat-message').count(), 1, 'closing history should leave a single quick chat input');
  const closedPanel = await mika.page.locator('.chat-panel').getAttribute('aria-hidden');
  assert.equal(closedPanel, 'true', 'the full transcript should stay hidden until opened from the header');
  const positionBeforeQuickTyping = await mika.page.locator('.player-map-pin').getAttribute('transform');
  await quickComposer.pressSequentially('wasd');
  await sleep(350);
  assert.equal(await mika.page.locator('.player-map-pin').getAttribute('transform'), positionBeforeQuickTyping, 'movement keys typed into the quick chat field must not move the character');
  await quickComposer.fill('Quick chat stays in the town.');
  await quickComposer.press('Enter');
  await june.page.getByText('Quick chat stays in the town.', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await mika.page.screenshot({ path: 'artifacts/qa/chat-quick-desktop.png' });

  const tablet = await context(820, 1024);
  await enter(tablet.page, 'Fern', 'Fern');
  const tabletOverflow = await tablet.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(tabletOverflow, false, 'tablet should not have page-level horizontal overflow');
  await tablet.page.screenshot({ path: 'artifacts/qa/town-tablet.png' });

  const mobile = await context(390, 844, true);
  await enter(mobile.page, 'Sol', 'Ember');
  const mobileOverflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(mobileOverflow, false, 'mobile should not have page-level horizontal overflow');
  await mobile.page.getByRole('button', { name: 'Open town map' }).click();
  await mobile.page.getByRole('dialog', { name: 'Kindred Town' }).waitFor({ state: 'visible' });
  await mobile.page.screenshot({ path: 'artifacts/qa/mobile-town-map.png' });
  await mobile.page.getByRole('dialog').getByRole('button', { name: 'Close town map' }).click();
  await mobile.page.getByRole('button', { name: 'Open chat history' }).click();
  await mobile.page.getByRole('tab', { name: /CURRENT/ }).waitFor({ state: 'visible' });
  const mobileHistoryBounds = await mobile.page.locator('.chat-panel').boundingBox();
  assert.ok(mobileHistoryBounds && mobileHistoryBounds.height < 500, 'mobile history drawer should stay compact');
  await mobile.page.screenshot({ path: 'artifacts/qa/mobile-chat-drawer.png' });

  await june.page.reload({ waitUntil: 'domcontentloaded' });
  await june.page.getByLabel('What should we call you?').waitFor({ state: 'visible' });
  assert.equal(await june.page.getByLabel('What should we call you?').inputValue(), 'June', 'nickname should survive a reload');
  await june.page.getByRole('button', { name: 'Enter the city' }).click();
  await june.page.getByRole('button', { name: 'Open chat history' }).waitFor({ state: 'visible', timeout: 10_000 });

  assert.deepEqual(errors, [], `browser console should be clean: ${errors.join(' | ')}`);
  console.log('BROWSER E2E PASS · 3 isolated desktop clients · avatar selection · presence · request/accept · private and group chat · local history identity · tablet/mobile layout · no horizontal overflow');
  console.log('Screenshots saved under artifacts/qa/ (landing, desktop, tablet, mobile).');
} finally {
  for (const browserContext of contexts) await browserContext.close();
  await browser.close();
}
