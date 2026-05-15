# AIExcel

AIExcel is a smart spreadsheet assistant project with two complementary paths:

- `addin/`, `backend/`, and `shared/`: an existing Office Add-in architecture for embedding AI directly inside Excel.
- `smart-excel-ai/`: a browser-based MVP for uploading Excel/CSV files, indexing every sheet, asking workbook-aware questions, finding duplicates, finding inconsistencies, cleaning data, and downloading cleaned workbooks.

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

The existing add-in/backend code remains in place for the fuller embedded Excel experience.

```bash
npm install
npm run dev
```

## AI Configuration

The browser MVP works without an API key by using local workbook tools. To connect a real AI provider, add provider values in `smart-excel-ai/.env.local`; keep keys server-side and do not expose them through browser `VITE_` variables.
