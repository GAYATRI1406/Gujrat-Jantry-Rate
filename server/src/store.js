// Lookup history. Uses MongoDB when it is reachable, otherwise a JSON file so the app still works.
const fs = require('fs');
const mongoose = require('mongoose');
const { MONGO_URI, HISTORY_FILE } = require('./config');

const Lookup = mongoose.model('Lookup', new mongoose.Schema({
  address: String,
  query: Object,
  result: Object,
  screenshots: [Object],
}, { timestamps: true }));

let useMongo = false;

async function connect() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2500 });
    useMongo = true;
    console.log(`[store] MongoDB connected: ${MONGO_URI}`);
  } catch (err) {
    console.log(`[store] MongoDB not reachable (${err.message.split('\n')[0]}) - saving history to ${HISTORY_FILE}`);
  }
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function save(entry) {
  if (useMongo) return (await Lookup.create(entry)).toObject();
  const all = readFile();
  const doc = { _id: String(Date.now()), createdAt: new Date().toISOString(), ...entry };
  all.unshift(doc);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(all.slice(0, 200), null, 2));
  return doc;
}

async function list(limit = 30) {
  if (useMongo) return Lookup.find().sort({ createdAt: -1 }).limit(limit).lean();
  return readFile().slice(0, limit);
}

module.exports = { connect, save, list, isMongo: () => useMongo };
