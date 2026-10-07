const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');

const config = {
  // 5000 is taken by a Windows system service on some machines
  PORT: Number(process.env.PORT) || 5050,
  BLOG_URL: 'https://gujaratlaw.blogspot.com/2014/08/gujarat-jantry-2011-latest-jantry.html',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jantri',
  // HEADED=1 also opens a real browser window on this machine
  HEADED: process.env.HEADED === '1',
  // pause between bot actions so a person can follow the live view
  STEP_DELAY: Number(process.env.STEP_DELAY) || 900,
  VIEWPORT: { width: 1280, height: 800 },
  DATA_DIR,
  PDF_DIR: path.join(DATA_DIR, 'pdfs'),
  INDEX_DIR: path.join(DATA_DIR, 'index'),
  SHOTS_DIR: path.join(DATA_DIR, 'shots'),
  LINKS_FILE: path.join(DATA_DIR, 'links.json'),
  HISTORY_FILE: path.join(DATA_DIR, 'history.json'),
};

for (const dir of [config.PDF_DIR, config.INDEX_DIR, config.SHOTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
