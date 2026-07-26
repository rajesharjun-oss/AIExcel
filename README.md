# AIExcel

AIExcel is a smart spreadsheet assistant project with two complementary paths:

- `addin/`, `backend/`, and `shared/`: an existing Office Add-in architecture for embedding AI directly inside Excel.
- `smart-excel-ai/`: a browser-based MVP for uploading Excel/CSV files, indexing every sheet, asking workbook-aware questions, finding duplicates, finding inconsistencies, cleaning data, translating sheets live, and downloading cleaned workbooks.
  Uploaded sheets open in an editable grid with direct cell entry, keyboard movement, and multi-cell paste support.

## Live Translation

Sheets can be translated in place from the toolbar:

- Pick a target language (English, Spanish, French, German, Portuguese, Italian), choose the scope (**Active sheet** or **All sheets**), and press **Translate**.
- Text cells and headers are translated; numbers, dates, currency amounts, emails, and identifiers are always preserved.
- Translation is non-destructive: **Revert** restores the original text at any time (until the workbook is edited).
- **Download Copy** exports the workbook exactly as shown — including translations and edits — as a new `.xlsx` file.
- With the backend running and an API key configured, translation uses the `/v1/translate` AI route; otherwise a built-in phrase dictionary keeps the feature working fully offline.

## Browser MVP

```bash
cd smart-excel-ai
npm install
npm run dev
```

Open:

```text
http://localhost:5177/
```

Or from the repository root:

```bash
npm run dev:web
```

## Office Add-in Scaffold

The existing add-in/backend code remains in place for the fuller embedded Excel experience. The taskpane now includes workbook-wide tools:

- Index workbook sheets and build a compact profile.
- Find duplicate rows across sheets.
- Find missing values, mixed column types, sparse rows, formula errors, and hardcoded formula numbers.
- Search all sheets from the taskpane.
- Clean the selected range by trimming and normalising whitespace.
- Send richer workbook context and recent findings to the backend chat route.

```bash
npm install
npm run dev
```

## AI Configuration

The browser MVP works without an API key by using local workbook tools. To connect a real AI provider, add provider values in `smart-excel-ai/.env.local`; keep keys server-side and do not expose them through browser `VITE_` variables.

## Automated Tests

Run the Smart Excel test suite from the repository root:

```bash
npm test
```

Run the browser e2e checks for Excel-like grid behavior:

```bash
npm run test:e2e
```

Run both suites:

```bash
npm run test:all
```

The suite lives under `smart-excel-ai/tests/`:

- `fixtures/` contains reusable sample CSV files for dirty data, duplicates, and rule analysis.
- `expected/` contains expected result snapshots for rule tests.
- `test_grid_behaviour.test.ts` checks workbook indexing, wide-column support beyond AZ, search, and large workbook performance.
- `test_upload_export.test.ts` checks CSV/XLSX upload parsing and cleaned workbook export.
- `test_cleaning.test.ts` checks duplicate detection, whitespace/date/number cleaning, blank required fields, invalid numbers, and outlier amounts.
- `test_rules.test.ts` checks rule-based categorization, review flags, and total preservation.
- `test_ai_chat.test.ts` checks the local Ask AI fallback uses current workbook findings and does not mutate data.
- `test_translation.test.ts` checks translatable-cell detection, dictionary translation, language detection, non-mutation, and revert support.
- `e2e/browser-grid.e2e.ts` starts Vite and headless Chrome to verify upload, real cell editing, multi-cell paste, keyboard movement, shortcut-style replacement, live translation with revert, and export readiness in the browser.

To add a new case, place a generic sample file in `smart-excel-ai/tests/fixtures/`, add expected counts or rows in `smart-excel-ai/tests/expected/` when useful, then add a focused assertion to the matching test file. Keep client-specific files out of the suite.
