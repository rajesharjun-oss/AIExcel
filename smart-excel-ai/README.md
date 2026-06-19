# Smart Excel AI

A fresh React/TypeScript MVP for an AI-assisted Excel workbook app.

## What It Does

- Upload `.xlsx`, `.xls`, `.xlsm`, or `.csv` files.
- Reads every sheet and builds a workbook index.
- Opens uploaded sheets in an editable grid with cell entry, keyboard movement, and multi-cell paste support.
- Lets users search across all sheets.
- Finds duplicate rows within and across sheets.
- Finds inconsistencies such as duplicate headers, sparse rows, missing values, and mixed column types.
- Creates basic cleaning suggestions and downloads a cleaned workbook.
- Includes an Ask AI panel that can answer workbook questions using local workbook tools.
- Includes a server-side `/api/ai` proxy hook for a real AI provider.

## Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5177/
```

## Build

```bash
npm run build
```

## Automated Tests

Run the test suite:

```bash
npm test
```

Run browser e2e tests for Excel-like grid behavior:

```bash
npm run test:e2e
```

Run both suites:

```bash
npm run test:all
```

From the repository root, the same suite is available with:

```bash
npm test
```

Test files are in `tests/`:

- `fixtures/`: sample CSV workbooks used only for tests.
- `expected/`: expected outputs and counts.
- `test_grid_behaviour.test.ts`: workbook indexing, wide columns beyond AZ, search, and large-file performance.
- `test_upload_export.test.ts`: CSV/XLSX upload parsing and cleaned export round-trips.
- `test_cleaning.test.ts`: duplicates, trimming, date normalization, invalid numbers, blank required fields, outlier amounts, and preservation checks.
- `test_rules.test.ts`: rule categorization, unmatched rows, invalid amount flags, and total preservation.
- `test_ai_chat.test.ts`: safe local assistant answers using current workbook data without mutating the workbook.
- `e2e/browser-grid.e2e.ts`: starts Vite and headless Chrome to verify upload, editable cells, multi-cell paste, keyboard movement, shortcut-style replacement, and export readiness in the browser.

Add new reusable samples to `tests/fixtures/` and keep client-specific files out of source control.

## AI Provider

The app works without an API key by using local workbook tools. To route Ask AI through a provider, create `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Or point it at a custom endpoint:

```bash
AI_API_URL=https://your-ai-service.example.com/analyze
AI_API_KEY=your_key_here
AI_MODEL=your_model_name
```

Keep provider keys on the server side. Do not place them in browser-exposed `VITE_` variables.
