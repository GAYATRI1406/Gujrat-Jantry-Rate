// The browser agent. Everything it does is streamed to the chat as live frames + step messages:
//   open the blog -> find and click the district PDF link -> open the PDF -> search -> highlight -> screenshot
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const config = require('./config');
const { pickLink, readBlogLinks, saveLinks, loadLinks, downloadPdf, fileNameOf } = require('./pdfSource');
const { openPdf } = require('./pdfIndex');
const { lookup } = require('./lookup');
const { choosePdf, KIND_LABEL } = require('./catalog');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (factor = 1) => sleep(config.STEP_DELAY * factor);

let browserPromise = null;

async function launch() {
  const errors = [];
  // use the Edge / Chrome already installed on this machine, else Playwright's own Chromium
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      const browser = await chromium.launch({ channel, headless: !config.HEADED });
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    } catch (err) {
      errors.push(err.message.split('\n')[0]);
    }
  }
  throw new Error(`No browser could be started. Install Microsoft Edge or Chrome, or run "npx playwright install chromium". (${errors.join(' | ')})`);
}

function getBrowser() {
  if (!browserPromise) browserPromise = launch().catch((err) => { browserPromise = null; throw err; });
  return browserPromise;
}

// A visible mouse pointer, so the person watching can see where the bot moves and clicks.
function fakeCursor() {
  const install = () => {
    if (document.getElementById('__bot_cursor')) return;
    const c = document.createElement('div');
    c.id = '__bot_cursor';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11h-7.5l-3.5 8z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = `position:fixed;left:-60px;top:-60px;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform .12s;background:url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') no-repeat`;
    document.documentElement.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.left = `${e.clientX - 4}px`; c.style.top = `${e.clientY - 2}px`; }, true);
    window.addEventListener('mousedown', () => { c.style.transform = 'scale(.75)'; }, true);
    window.addEventListener('mouseup', () => { c.style.transform = ''; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}


async function pointAtLink(page, link) {
  const el = await page.evaluateHandle((href) => [...document.querySelectorAll('a[href]')].find((a) => a.href === href), link.href);
  if (!el.asElement()) return;
  await el.evaluate((a) => a.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await pause(1.2);
  await el.evaluate((a) => {
    a.style.cssText += ';outline:3px solid #ff5722;outline-offset:3px;background:#fff59d;border-radius:3px;';
    a.addEventListener('click', (e) => e.preventDefault()); // the bot opens the PDF in its own viewer
  });
  const box = await el.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 35 });
  await pause(0.6);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.up();
  await pause(0.6);
}

async function typeSearch(page, text) {
  const input = page.locator('#q');
  await input.click();
  await input.fill('');
  await input.pressSequentially(text, { delay: 75 });
  await pause(0.5);
}

// Joins PNG strips top to bottom into one PNG (drawn on a canvas inside the page).
async function stitch(page, pngs) {
  const dataUrl = await page.evaluate(async (sources) => {
    const load = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    const images = await Promise.all(sources.map(load));
    const gap = 8;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...images.map((i) => i.width));
    canvas.height = images.reduce((h, i) => h + i.height, 0) + gap * (images.length - 1);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const img of images) {
      g.drawImage(img, 0, y);
      y += img.height + gap;
    }
    return canvas.toDataURL('image/png');
  }, pngs.map((b) => `data:image/png;base64,${b.toString('base64')}`));
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// job: { id, query }   emit: (message) => void, emit.frame: (jpegBuffer) => void
async function runJob(job, emit) {
  const q = job.query;
  const step = (text, key) => emit({ type: 'step', text, key });
  const origin = `http://127.0.0.1:${config.PORT}`;

  step('Starting the browser');
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: config.VIEWPORT, deviceScaleFactor: 2 });
  await context.addInitScript(fakeCursor);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (frame) => {
    emit.frame(Buffer.from(frame.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 70, maxWidth: config.VIEWPORT.width, maxHeight: config.VIEWPORT.height, everyNthFrame: 1,
  });

  try {
    // 1. Open the blog page and find the PDF link for this district
    step('Opening the Gujarat Jantri website');
    emit({ type: 'url', url: config.BLOG_URL });
    let links = [];
    try {
      await page.goto(config.BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await pause();
      links = await readBlogLinks(page);
      if (links.length) saveLinks(links);
    } catch (err) {
      step(`Website did not load (${err.message.split('\n')[0]}) - using the saved link list`);
    }
    if (!links.length) links = loadLinks();
    if (!links.length) throw new Error('Could not read the PDF links from the website.');

    // Which PDF holds this property: decided from what is inside the PDFs, not from the file names
    let link;
    let pdfNotes = [];
    try {
      const chosen = choosePdf(q);
      q.pdfType = chosen.file.kind;
      pdfNotes = chosen.notes;
      link = links.find((l) => l.href === chosen.file.href) || { href: chosen.file.href };
    } catch (err) {
      // district not in the catalog (not built yet, or new on the website): go by the file name
      link = pickLink(links, q.district, q.pdfType);
      if (!link) throw err;
    }
    const typeLabel = KIND_LABEL[q.pdfType] || q.pdfType;
    step(`Looking for the ${q.district} ${typeLabel} PDF link`);
    if (!link) throw new Error(`The website has no ${typeLabel} PDF for district "${q.district}".`);
    await pointAtLink(page, link).catch(() => {});

    // 2. Download the PDF (kept on disk for next time)
    const linkName = fileNameOf(link.href);
    step(`Downloading ${linkName}`, 'download');
    const pdf = await downloadPdf(link.href, (got, total) => {
      const mb = (n) => (n / 1048576).toFixed(1);
      step(`Downloading ${linkName} - ${mb(got)}${total ? ` / ${mb(total)}` : ''} MB`, 'download');
    });
    step(pdf.cached ? `${pdf.name} is already downloaded` : `Downloaded ${pdf.name}`, 'download');

    // 3. Open it in the viewer
    step('Opening the PDF');
    emit({ type: 'url', url: link.href });
    await page.goto(`${origin}/viewer.html`, { waitUntil: 'load' });
    const pageCount = await page.evaluate(([url, name]) => window.JV.open(url, name), [`/pdfs/${encodeURIComponent(pdf.name)}`, pdf.name]);
    await pause();

    // 4. Find the section, the number and the rate
    step(`Reading ${pageCount} pages`, 'read');
    const doc = await openPdf(pdf.file);
    let result;
    try {
      result = await lookup(doc, pdf.file, q, pdf.name, (done, total) => step(`Reading pages ${done} / ${total}`, 'read'));
    } finally {
      await doc.destroy();
    }
    result.notes.unshift(...pdfNotes);
    step(`Read ${pageCount} pages`, 'read');

    // 5. Replay the search in the live view
    const [sectionTerm, ...numberTerms] = result.searches;
    if (sectionTerm) {
      step(`Searching for section "${sectionTerm}"`);
      await typeSearch(page, sectionTerm);
    }
    if (result.sectionPages.length) {
      await page.evaluate((p) => window.JV.show(p), result.sectionPages[0]);
      step(`Found section ${result.section} (page ${result.sectionPages[0]})`);
      await pause();
    }
    for (const term of numberTerms) {
      step(`Searching for ${term}`);
      await typeSearch(page, term);
    }

    const shots = [];
    const main = result.evidence[0];
    if (main) {
      // flip through the section pages up to the one with the match
      const between = result.sectionPages.filter((p) => p > result.sectionPages[0] && p < main.page).slice(-4);
      for (const p of between) {
        await page.evaluate((n) => window.JV.show(n), p);
        await pause(0.5);
      }
    }
    for (const [i, ev] of result.evidence.entries()) {
      await page.evaluate((n) => window.JV.show(n), ev.page);
      await page.evaluate((rects) => window.JV.mark(rects), ev.rects);
      if (i === 0) step(`Match found on page ${ev.page} - highlighting it`);
      await pause(1.3);
      step('Taking the screenshot', 'shot');
      const name = `${job.id}-${i + 1}`;
      // evidence = the page's column titles + the matched block, as one image
      const strips = [];
      for (const kind of ['head', 'block']) {
        const mark = page.locator(`.mark.${kind}`).first();
        if (await mark.count()) strips.push(await mark.screenshot());
      }
      fs.writeFileSync(path.join(config.SHOTS_DIR, `${name}.png`), strips.length > 1 ? await stitch(page, strips) : strips[0]);
      await page.locator('#sheet').screenshot({ path: path.join(config.SHOTS_DIR, `${name}-page.png`) });
      shots.push({ url: `/shots/${name}.png`, pageUrl: `/shots/${name}-page.png`, page: ev.page, caption: ev.caption });
    }
    if (!result.evidence.length) {
      step('No matching entry to highlight');
      await pause();
      const name = `${job.id}-1`;
      await page.screenshot({ path: path.join(config.SHOTS_DIR, `${name}.png`) });
      shots.push({ url: `/shots/${name}.png`, pageUrl: `/shots/${name}.png`, page: result.sectionPages[0] || 1, caption: 'Nothing matched - current view' });
    }
    if (shots.length) step(`Screenshot saved (${shots.length})`, 'shot');
    await pause();

    delete result.evidence;
    return { result, screenshots: shots, pdfUrl: link.href };
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await context.close().catch(() => {});
  }
}

module.exports = { runJob, getBrowser };
