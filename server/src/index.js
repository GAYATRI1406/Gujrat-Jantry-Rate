const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config');
const store = require('./store');
const { parseAddress } = require('./addressParser');
const { PROPERTY_TYPES } = require('./lookup');
const { runJob } = require('./bot');
const { districts, places } = require('./catalog');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, mongo: store.isMongo() }));
app.get('/api/options', (req, res) => res.json({ propertyTypes: PROPERTY_TYPES, districts: districts() }));
app.get('/api/places', (req, res) => res.json(places(req.query.district)));
app.post('/api/parse', (req, res) => res.json(parseAddress(req.body.address)));
app.get('/api/history', async (req, res) => res.json(await store.list()));

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
    const q = msg.query || {};
    if (!q.district) return send({ type: 'error', message: 'District is required to pick the PDF.' });
    if (busy) return send({ type: 'error', message: 'The bot is busy with another search. Try again in a moment.' });

    busy = true;
    const job = { id: Date.now().toString(36), query: q };
    try {
      const out = await runJob(job, send);
      const saved = await store.save({ address: msg.address || '', query: q, result: out.result, screenshots: out.screenshots });
      send({ type: 'result', id: saved._id, ...out });
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
