// Picks the right PDF link from the blog page and downloads it (cached on disk).
const fs = require('fs');
const path = require('path');
const { PDF_DIR, LINKS_FILE } = require('./config');

const key = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function fileNameOf(href) {
  return decodeURIComponent(href.split('?')[0].split('/').pop());
}

// links: [{ href, text }] taken from the blog page. Rural Agri is never used.
function pickLink(links, district, pdfType) {
  const want = key(district);
  return links.find((l) => {
    const name = fileNameOf(l.href).replace(/\.pdf$/i, '').toUpperCase();
    const words = name.split(/[^A-Z0-9]+/);
    if (!want || !key(name).startsWith(want)) return false;
    if (words.includes('AGRI')) return false;
    if (pdfType === 'CORPORATION') return words.includes('CORPORATION');
    if (pdfType === 'NAGARPALIKA') return words.includes('NAGARPALIKA');
    return words.includes('RURAL') && words.includes('NA');
  }) || null;
}

// Every PDF link on the blog page, with the district name of the table row it sits in.
function readBlogLinks(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .filter((a) => /\.pdf(\?|$)/i.test(a.href))
    .map((a) => {
      const row = a.closest('tr');
      return { href: a.href, text: a.textContent.trim(), row: row && row.children[0] ? row.children[0].innerText.trim() : '' };
    }));
}

function saveLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links));
}

function loadLinks() {
  try {
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function downloadPdf(href, onProgress) {
  const name = fileNameOf(href);
  const file = path.join(PDF_DIR, name);
  if (fs.existsSync(file)) return { file, name, cached: true };

  const candidates = [href];
  if (href.startsWith('http://')) candidates.push(href.replace('http://', 'https://'));
  let lastError;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const chunks = [];
      let got = 0;
      let lastShown = 0;
      for await (const chunk of res.body) {
        chunks.push(chunk);
        got += chunk.length;
        if (onProgress && got - lastShown > 300000) {
          lastShown = got;
          onProgress(got, total);
        }
      }
      const data = Buffer.concat(chunks);
      if (data.subarray(0, 4).toString() !== '%PDF') throw new Error('the link did not return a PDF file');
      fs.writeFileSync(file, data);
      return { file, name, cached: false };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not download ${name}: ${lastError.message}`);
}

module.exports = { pickLink, readBlogLinks, saveLinks, loadLinks, downloadPdf, fileNameOf };
