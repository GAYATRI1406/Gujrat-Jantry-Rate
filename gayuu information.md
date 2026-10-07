# Jantri Rate Lookup: how to use it

## What it does

You give it a property in Gujarat. It opens the Jantri (ASR 2011) website, picks the right PDF for that district, finds the property's row, and gives you:

- the rate in rupees per sq. mt. for your property type
- a screenshot of the exact row it read, with the column headings
- notes when it had to use a fallback or the answer needs a manual check

You can watch the bot do all of this live on the right side of the screen.

## Start it

1. Open a terminal in the project folder `D:\Gayatri_Project`.
2. Run `npm start`.
3. Open **http://localhost:5050** in your browser.

## Search for a rate

There are three buttons at the bottom of the left panel. Use whichever is easiest.

### 1. Select details
Pick from lists, top to bottom. Each box unlocks after the one before it.

1. District
2. Area type: city (Corporation), town (Nagarpalika) or village (Rural NA)
3. Taluka
4. Village
5. TPS No. (only shown when that village has TPS schemes)
6. Type the number: **FP No.** if you chose a TPS, otherwise the **Survey / RS No.**
7. Property type
8. Press **Search Jantri rate**

### 2. Chat
The bot asks one question at a time. Click one of the answers shown under the question, or type your answer in the box and press Enter. It starts the search by itself when it has everything.

### 3. Type address
Paste the full address and press **Send**, for example:

```
Moje Kosad, TPS No. 66, FP No. 327, Flat No. 1404, Tal. Surat City, Dist. Surat
```

The bot shows what it read from the address. Correct anything that is wrong, then press **Search Jantri rate**.

## Read the result

| Result | Meaning |
|---|---|
| **Rate found** | The number was found and the rate is shown. |
| **Fallback value used** | The exact number or cell was missing, so a fallback rule was used. The notes say which one. |
| **No data found** | The number is not listed, or the rate cell is empty in the PDF. |
| **Insufficient data found** | Flat, Shop or Office was asked for in a village PDF, which has no such columns. |
| **Needs a manual check** | The number is listed more than once, or two fallbacks disagree. Check the screenshot. |

Click the screenshot to enlarge it. **Full page** shows the whole PDF page. **History** (top right) lists earlier searches.

## Screen tips

- Drag the bar between the two panels to resize them.
- **Full window** makes the live browser fill the screen.

## How it works, in short

1. The bot opens the blog page that lists the Jantri PDFs and clicks the link for your district.
2. It downloads that PDF once and keeps it for next time.
3. It reads the PDF's text and finds your village (and TPS section, if any).
4. It looks for your number in that section:
   - **City / town PDFs:** FP No. inside the TPS section, or Survey No. when there is no TPS. If the FP No. is missing, it tries the FP number just before and just after.
   - **Village PDFs:** RS No. first, then BL No., then the village baseline (Gamtal) rate.
5. It picks the rate column for your property type, highlights the row and takes the screenshot.

The bot decides which PDF to use from what is printed inside each PDF, not from the file name on the website, because several files there are mislabelled.

## Limits to know

- **Ahmedabad city (AMC) does not work.** That PDF's text cannot be read by a program. Ahmedabad's towns and villages do work.
- **Banaskantha has no village (Rural NA) PDF** on the website.
- **Rural Agri PDFs are never used.**
- In towns the same survey number can appear in more than one ward. The bot takes the first one and marks it for a manual check.
- Search history is saved to a file on this PC unless MongoDB is installed.

## If the website changes

Run `npm run sync` to re-read every PDF (about 25 minutes), then `npm run selftest` to check the lookups.
