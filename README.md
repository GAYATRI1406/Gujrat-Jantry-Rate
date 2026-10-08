# Gujarat Jantri Rate Bot

Looks up the Jantri rate (Annual Statement of Rates 2011) for a property in Gujarat, works out the government value, and returns a screenshot of the source page as evidence. It can be used from the browser or called as an API from other software.

The rates come from the PDFs published by the Revenue Department and linked from
`https://gujaratlaw.blogspot.com/2014/08/gujarat-jantry-2011-latest-jantry.html`.

**Accuracy rule:** a rate is returned only when the property's number is matched exactly. Anything else returns no rate, with suggestions that must be checked by hand.

## Requirements

- Node.js 20 or newer
- Microsoft Edge or Google Chrome (used to render the PDF pages for screenshots)
- Internet access for the first run
- MongoDB is optional; without it, search history is kept in a file

## Setup and run

```
npm install
npm run sync       # one time, about 50 minutes: downloads and reads all 81 Jantri PDFs
npm start          # builds the screen and starts the server
```

Open `http://localhost:5050`. To use another port: `$env:PORT=6000; npm start` (PowerShell).

| Command | What it does |
|---|---|
| `npm start` | Build the client and start the server |
| `npm run dev` | Server and client with auto-reload (client on port 5173) |
| `npm run sync` | Re-read all PDFs from the website and rebuild `server/catalog.json` |
| `npm run selftest` | Look up real numbers taken from every PDF and check the results |
| `npm run report` | Run the cases in `testing/cases.json` through the API (server must be running) and write `testing/jantri-test-report.csv` with screenshots |

The "official rate" column of the report is not produced by the bot. It comes from `testing/official.json`, which is filled in by reading the source pages independently.

## API

### `POST /api/jantri/lookup`

No authentication yet. The place to add a key check is marked in `server/src/index.js`.

**Request body (JSON)**

| Field | Required | Notes |
|---|---|---|
| `state` | no | Must be `Gujarat` if given |
| `district` | yes | As on the website, e.g. `Surat`, `Kutch`, `Mehsana` |
| `taluka` | no | Needed only when the village name exists in more than one taluka |
| `village` | yes | Must match the name printed in the PDF |
| `surveyNumber` | one of these | Survey / RS / City Survey number |
| `tpScheme` + `fpNumber` | one of these | TP scheme number and Final Plot number |
| `blockNumber` | one of these | Verifies only where the PDF has a Block No. list |
| `propertyType` | yes | `Residential`, `Commercial`, `Industrial`, `Agricultural`, `Flat`, `Shop`, `Office`, `Plot`. `Agricultural` needs `propertySubType` `Irrigated` or `Non-irrigated` |
| `propertySubType` | no | Narrows a general type: `Flat` / `Plot`, `Shop` / `Office`, `Irrigated` / `Non-irrigated` |
| `areaType` | no | `corporation`, `nagarpalika` or `rural`. Found automatically when the village is in only one PDF |
| `areaSqmt` | no | Area in sq. mt. |
| `area` + `areaUnit` | no | Alternative to `areaSqmt`. Units: `sqmt`, `sqft`, `sqyd`, `guntha`, `acre`, `hectare`, `are` |

**Example**

```
curl -X POST http://localhost:5050/api/jantri/lookup -H "Content-Type: application/json" -d "{\"state\":\"Gujarat\",\"district\":\"Surat\",\"taluka\":\"Surat City\",\"village\":\"Kosad\",\"tpScheme\":\"66\",\"fpNumber\":\"327\",\"propertyType\":\"Flat\",\"areaSqmt\":100}"
```

```json
{
  "status": "verified",
  "matchType": "exact",
  "requiresManualVerification": false,
  "district": "SURAT",
  "village": "Kosad",
  "areaType": "corporation",
  "tpScheme": "66",
  "fpNumber": "327",
  "propertyType": "Flat / Apartment",
  "jantriRate": 12750,
  "rateUnit": "sqmt",
  "rateCategory": "Residential flat / apartment",
  "rateSource": "Jantri (Annual Statement of Rates) 2011",
  "areaSqmt": 100,
  "governmentValue": 1275000,
  "formula": "Government Value = Property Area (Sq. Mtr.) × Jantri Rate (per Sq. Mtr.)",
  "calculation": "100 × 12,750 = ₹12,75,000",
  "matchedEntry": { "field": "FP No.", "given": "327", "printed": "327", "listLabel": "FP. No TPS-66", "zone": "31/22" },
  "sourceDocument": "Surat-CORPORATION.pdf",
  "sourceUrl": "http://revenuedepartment.gujarat.gov.in/downloads/Surat-CORPORATION.pdf",
  "pageNumber": 214,
  "screenshotUrl": "http://localhost:5050/shots/api-xxxx-1.png",
  "pageScreenshotUrl": "http://localhost:5050/shots/api-xxxx-1-page.png",
  "evidenceChecked": true,
  "candidates": [],
  "suggestions": [],
  "notes": []
}
```

### Statuses

`jantriRate` and `governmentValue` are filled **only** when `status` is `verified`.

| `status` | HTTP | Meaning |
|---|---|---|
| `verified` | 200 | The number is listed exactly once and the rate cell is filled. |
| `not_found` | 200 | "Exact Match Not Found". `reason` says what was missing: `district_not_found`, `village_not_found`, `tps_not_in_village`, `tps_required`, `number_not_found`, `survey_number_required`. |
| `ambiguous` | 200 | More than one answer is possible. `candidates` lists them. Reasons: `multiple_entries`, `property_type_too_general`, `village_in_several_documents`, `village_in_several_talukas`. |
| `rate_not_available` | 200 | The entry was found but its rate cell is blank in the PDF. |
| `unsupported` | 200 | The record cannot be served: `document_not_readable`, `document_not_available` (for example non-agricultural land in Banaskantha villages), `property_type_not_in_table`. |
| `invalid_input` | 400 | The request is incomplete or wrong. `errors` lists each problem. |
| `error` | 200 / 500 | The rate could not be confirmed against the source page (`evidence_check_failed`), or the server failed. |

`suggestions` and `candidates` are near misses (a neighbouring FP number, a part of the same survey number, the village baseline rate, and so on). Each has `requiresManualVerification: true` and must never be used as the property's rate without a manual check.

### Evidence

Every verified result includes the source document, its URL, the page number and two screenshots: the matched entry with the column headings, and the full page. Before a rate is returned, the server reads back the text under the highlighted cell and confirms it is the same number (`evidenceChecked: true`). If that check fails, the rate is withdrawn and the status becomes `error`.

### Government value

`governmentValue = areaSqmt × jantriRate`, rounded to the nearest rupee. No other charges, factors or rules are applied. Bigha / vigha are rejected because their size varies by region.

## How a lookup works

1. The district's PDFs are identified from `server/catalog.json`, which records what each PDF really contains (the website's file names are not reliable).
2. The village section is found by exact name, with the TP scheme when one is given.
3. The number is searched in the lists of the right kind: an FP number in FP lists, a survey number in survey lists.
4. Exactly one match gives the entry; the rate column is chosen from the property type.
5. The page is rendered, the entry is highlighted and photographed, and the highlighted cell is checked against the rate.

## Rate columns

| City / town PDFs (Corporation, Nagarpalika) | Village PDFs: Rural NA | Village PDFs: Rural Agri |
|---|---|---|
| Open plot, Residential flat / apartment, Office, Shop, Open plot (industrial), Agricultural irrigated, Agricultural non-irrigated | Residential, Commercial, Industrial | Agricultural non-irrigated, Agricultural irrigated |

For a village, the property type decides the PDF: agricultural types are looked up in Rural Agri, all others in Rural NA.

The Rural Agri PDFs print each rate per acre with the per sq. mt. figure in brackets. `jantriRate` is the per sq. mt. figure and is the one used for `governmentValue`; `jantriRatePerAcre` returns the per-acre figure as printed. The sq. mt. figure is rounded, so one acre at 128 per sq. mt. gives 5,17,998 against the printed 5,18,000 per acre.

In city and town PDFs, `Residential` alone can mean open plot or flat, and `Commercial` can mean office or shop, so those return `ambiguous` until a sub-type is given.

## Known limits

- **Ahmedabad Municipal Corporation (`amc.pdf`)** is published with fonts that lost their character names. `npm run sync` writes a corrected copy that is used for reading text only (`server/src/textTwin.js`); screenshots still come from the original. Its sections have long names such as `NAVA VADAJ- FINAL T.P.S NO - 28`. Send either that full name as `village`, or the village with `tpScheme` (`Nava Vadaj` + `28`).
- **Banaskantha** has no Rural NA PDF on the website, so only agricultural land is covered for its villages.
- Rates are the 2011 figures as printed. No later revision is applied.

## Project layout

```
server/src/index.js        HTTP server, API route, WebSocket for the live screen
server/src/service.js      Request reading, valuation, API response
server/src/lookup.js       Strict matching rules
server/src/catalog.js      Which PDF holds which district and village
server/src/pdfIndex.js     Reads the PDF tables
server/src/textTwin.js     Repairs PDFs whose text is unreadable (Ahmedabad city)
server/src/names.js        Section names: village and TP scheme
server/src/bot.js          Browser automation, screenshots, evidence check
server/src/valuation.js    Area units and the value formula
server/scripts/            sync and selftest
client/src/                The screen: Select, Chat and Type address
```
