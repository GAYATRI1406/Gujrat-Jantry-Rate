const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config');
const store = require('./store');
const { parseAddress } = require('./addressParser');
const { PROPERTY_TYPES } = require('./lookup');
const { runJob, quickEvidence, enforceEvidence } = require('./bot');
const { readRequest, applyValuation, findRate, toApiResponse } = require('./service');
const { districts, places } = require('./catalog');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, mongo: store.isMongo() }));
app.get('/api/options', (req, res) => res.json({ propertyTypes: PROPERTY_TYPES, districts: districts() }));
app.get('/api/places', (req, res) => res.json(places(req.query.district)));
app.post('/api/parse', (req, res) => res.json(parseAddress(req.body.address)));
app.get('/api/history', async (req, res) => res.json(await store.list()));

// ---------- integration API (open for now; add a key check here when security is needed) ----------
app.use('/api/jantri', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

let apiQueue = Promise.resolve(); // lookups run one after another
const inTurn = (work) => {
  const run = apiQueue.then(work, work);
  apiQueue = run.catch(() => {});
  return run;
};

// POST /api/jantri/lookup  { district, taluka, village, surveyNumber | tpScheme + fpNumber, propertyType, areaSqmt, ... }
app.post('/api/jantri/lookup', async (req, res) => {
  const request = readRequest(req.body);
  if (request.errors) {
    return res.status(400).json({ status: 'invalid_input', matchType: 'none', requiresManualVerification: true, message: request.errors.join(' '), errors: request.errors });
  }
  const { q, area } = request;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  try {
    const body = await inTurn(async () => {
      const { result, file } = await findRate(q);
      const shots = await quickEvidence(result, `api-${Date.now().toString(36)}`);
      enforceEvidence(result, shots);
      applyValuation(result, area);
      delete result.evidence;
      await store.save({ address: '', query: q, result, screenshots: shots }).catch(() => {});
      return toApiResponse({ result, file, shots, area, baseUrl });
    });
    return res.json(body);
  } catch (err) {
    console.error('[api lookup failed]', err);
    return res.status(500).json({ status: 'error', matchType: 'none', requiresManualVerification: true, message: err.message.split('\n')[0] });
  }
});

app.use('/shots', express.static(config.SHOTS_DIR));
app.use('/pdfs', express.static(config.PDF_DIR));
app.use('/pdfjs', express.static(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'build')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) app.use(express.static(clientDist));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let busy = false; // one browser session at a time

wss.on('connection', (ws) => {
  const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  send.frame = (jpeg) => ws.readyState === ws.OPEN && ws.send(jpeg);

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type !== 'run') return;
    const request = readRequest(msg.query || {});
    if (request.errors) return send({ type: 'error', message: request.errors.join(' ') });
    if (busy) return send({ type: 'error', message: 'The bot is busy with another search. Try again in a moment.' });

    busy = true;
    const { q, area } = request;
    const job = { id: Date.now().toString(36), query: q, area };
    try {
      const { result, screenshots, file } = await runJob(job, send);
      result.source = file ? { document: result.pdf, url: file.href } : null;
      const saved = await store.save({ address: msg.address || '', query: q, result, screenshots });
      send({ type: 'result', id: saved._id, result, screenshots });
    } catch (err) {
      console.error('[job failed]', err);
      send({ type: 'error', message: err.message.split('\n')[0] });
    } finally {
      busy = false;
    }
  });
});

store.connect().then(() => {
  server.listen(config.PORT, () => console.log(`[server] http://localhost:${config.PORT}`));
});
