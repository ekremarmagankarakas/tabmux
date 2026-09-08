import { test, expect } from './fixtures.js';
import { sessionsStorage, tabByUrl, closeInitialBlankTab } from './helpers.js';

async function command(page, text) {
  await page.keyboard.press('Control+b'); await page.keyboard.press(':');
  await page.locator('#tabmux-host input').fill(text);
  await page.keyboard.press('Enter');
}

test('webpage-generated keys cannot close tabs or submit extension prompts', async ({context,baseUrl,serviceWorker}) => {
  const page = await context.newPage(); await page.goto(baseUrl);
  await page.evaluate(() => {
    for (const props of [{key:'b',ctrlKey:true},{key:'x'}]) window.dispatchEvent(new KeyboardEvent('keydown',{...props,bubbles:true}));
  });
  expect(await tabByUrl(serviceWorker,baseUrl)).toBeTruthy();
  await page.keyboard.press('Control+b'); await page.keyboard.press(':');
  await page.locator('#tabmux-host input').fill('save synthetic');
  await page.locator('#tabmux-host input').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true})));
  expect(await sessionsStorage(serviceWorker)).not.toHaveProperty('synthetic');
  await expect(page.locator('#tabmux-host input')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain('synthetic');
});

test('copy mode scrolls the clicked nested container and releases page shortcuts on exit', async ({context,baseUrl}) => {
  const page = await context.newPage(); await page.goto(baseUrl);
  await page.evaluate(() => {
    const box = document.createElement('div'); box.id='scrollbox';
    box.style.cssText='height:180px;overflow-y:auto';
    box.innerHTML='<div style="height:2000px">nested content</div>';
    document.body.append(box);
  });
  await page.locator('#scrollbox').click({position:{x:20,y:20}});
  await page.keyboard.press('Control+b'); await page.keyboard.press('['); await page.keyboard.press('j');
  await expect.poll(() => page.locator('#scrollbox').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('G');
  await expect.poll(() => page.locator('#scrollbox').evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tabmux-host .bar')).toBeHidden();
});

test('changing tabs resets copy mode', async ({context,baseUrl,serviceWorker}) => {
  const page = await context.newPage(); await page.goto(baseUrl);
  await page.keyboard.press('Control+b'); await page.keyboard.press('[');
  const other = await context.newPage(); await other.goto(baseUrl+'other'); await other.bringToFront();
  const next = await tabByUrl(serviceWorker,baseUrl+'other');
  await serviceWorker.evaluate(id => chrome.tabs.update(id,{active:true}),next.id);
  await expect(page.locator('#tabmux-host .bar')).toBeHidden();
});

test('failed autosave stays visible and retry saves successfully', async ({context,baseUrl,serviceWorker}) => {
  const page = await context.newPage(); await page.goto(baseUrl);
  await closeInitialBlankTab(serviceWorker);
  await command(page,'save work');
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain('work');
  const source = await tabByUrl(serviceWorker,baseUrl);
  await serviceWorker.evaluate(async ({windowId,url}) => {
    globalThis.originalStorageSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async () => { throw new Error('Test storage failure'); };
    await chrome.tabs.create({windowId,url,active:false});
  },{windowId:source.windowId,url:baseUrl+'extra'});
  await expect(page.locator('#tabmux-host .failure')).toContainText('Not saved');
  await serviceWorker.evaluate(() => { chrome.storage.local.set = globalThis.originalStorageSet; });
  await page.locator('#tabmux-host .failure button').click();
  await expect(page.locator('#tabmux-host .failure')).toHaveCount(0);
  await expect.poll(async () => (await sessionsStorage(serviceWorker)).work.tabs.length).toBe(2);
});

test('toolbar picker can save and switch sessions while New Tab is active', async ({context,extensionId,serviceWorker}) => {
  // Load the real popup document in a background tab so its active-tab query
  // targets New Tab, just as the browser action popup does.
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({'tabmux:sessions':{destination:{savedAt:Date.now(),tabs:[{url:'https://example.com/restored'}],groups:[]}}});
    await chrome.tabs.create({url:'chrome://newtab/',active:true});
  });
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const [popup] = await Promise.all([
    context.waitForEvent('page',p => p.url().includes('popup.html') || p.url() === ''),
    serviceWorker.evaluate(url => chrome.tabs.create({url,active:false}),popupUrl),
  ]);
  await popup.waitForURL(popupUrl);
  await expect(popup.locator('#current')).toHaveText('current: unnamed window');
  await popup.locator('#name').fill('newtab-session');
  await popup.locator('#save').click();
  await expect(popup.locator('#current')).toHaveText('current: newtab-session');
  await expect(popup.locator('#sessions')).toContainText('newtab-session');
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.action.default_popup).toBe('popup.html');
  expect(manifest.commands._execute_action).toBeTruthy();
  await popup.screenshot({path:test.info().outputPath('popup.png')});
  await popup.locator('#sessions button').filter({hasText:'destination'}).click();
  await expect.poll(async () => !!(await tabByUrl(serviceWorker,'https://example.com/restored'))).toBe(true);
});
