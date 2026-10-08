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
8. Property area and unit (optional, for the government value)
9. Press **Search Jantri rate**

### 2. Chat
The bot asks one question at a time. Click one of the answers shown under the question, or type your answer in the box and press Enter. It starts the search by itself when it has everything.

### 3. Type address
Paste the full address and press **Send**, for example:

```
Moje Kosad, TPS No. 66, FP No. 327, Flat No. 1404, Tal. Surat City, Dist. Surat
```

The bot shows what it read from the address. Correct anything that is wrong, then press **Search Jantri rate**.

## Read the result

A rate is shown only when the property's number is matched exactly. In every other case no rate is given, and you must check by hand.

| Result | Meaning |
|---|---|
| **Verified rate** | The number is listed exactly once and the rate is shown, with the screenshot of that entry. |
| **Exact Match Not Found** | The district, village or number is not listed. Suggestions may be shown below, but they are not the property's rate. |
| **Ambiguous** | The number is listed more than once, or the property type is too general (for example "Commercial" in a city, which can be Office or Shop). |
| **Rate not available** | The entry was found, but its rate cell is blank in the PDF. |
| **Not supported** | The website has no PDF for that area, or the table has no rate for that property type. |

If you enter the property area, a verified result also shows the **government value**: area in sq. mt. multiplied by the rate, with the calculation written out. No other charges are added.

Click the screenshot to enlarge it. **Full page** shows the whole PDF page. **History** (top right) lists earlier searches.

## Screen tips

- Drag the bar between the two panels to resize them.
- **Full window** makes the live browser fill the screen.

## How it works, in short

1. The bot opens the blog page that lists the Jantri PDFs and clicks the link for your district.
2. It downloads that PDF once and keeps it for next time.
3. It reads the PDF's text and finds your village (and TPS section, if any).
4. It looks for your number in that section, and it must match exactly:
   - **City / town PDFs:** FP No. inside the TPS section, or Survey No. when there is no TPS.
   - **Village PDFs:** the Survey (RS) No.
   - Near misses, such as the neighbouring FP number or the village baseline rate, are listed only as suggestions.
5. It picks the rate column for your property type, highlights the entry, takes the screenshot, and checks that the highlighted number is the rate it returns.

The bot decides which PDF to use from what is printed inside each PDF, not from the file name on the website, because several files there are mislabelled.

## Limits to know

- **Ahmedabad city (AMC)** works, but its sections have long names such as `NAVA VADAJ- FINAL T.P.S NO - 28`. Use **Select details** or **Chat** to pick the name from the list.
- **Banaskantha has no village (Rural NA) PDF** on the website, so only agricultural land works for its villages.
- **Agricultural land in a village:** choose Rural NA (village), then Agricultural - irrigated or non irrigated. The bot reads the Rural Agri PDF for those.
- In towns the same survey number can appear in more than one ward. The bot then returns no rate and lists every place it found.
- Search history is saved to a file on this PC unless MongoDB is installed.

## If the website changes

Run `npm run sync` to re-read every PDF (about 50 minutes), then `npm run selftest` to check the lookups.
