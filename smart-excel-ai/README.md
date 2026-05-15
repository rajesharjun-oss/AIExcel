# Smart Excel AI

A fresh React/TypeScript MVP for an AI-assisted Excel workbook app.

## What It Does

- Upload `.xlsx`, `.xls`, `.xlsm`, or `.csv` files.
- Reads every sheet and builds a workbook index.
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
