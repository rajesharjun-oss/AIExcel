import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

type RawRequest = {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
};

const readJsonBody = (req: RawRequest) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });

const extractText = (data: any): string => {
  if (typeof data?.output_text === 'string') return data.output_text;
  const message = data?.choices?.[0]?.message?.content;
  if (typeof message === 'string') return message;
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((part: any) => part?.text).filter(Boolean).join('\n');
  }
  return JSON.stringify(data, null, 2);
};

const aiProxyPlugin = (): Plugin => ({
  name: 'smart-excel-ai-proxy',
  configureServer(server) {
    server.middlewares.use('/api/ai', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await readJsonBody(req as RawRequest);
        const apiUrl = process.env.AI_API_URL || (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1/responses' : '');
        const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';

        if (!apiUrl || !apiKey) {
          res.statusCode = 501;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'AI provider is not configured. Falling back to local workbook tools.' }));
          return;
        }

        const isOpenAiResponses = apiUrl.includes('/v1/responses');
        const providerBody = isOpenAiResponses
          ? {
              model: process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini',
              input: [
                {
                  role: 'system',
                  content:
                    'You are Smart Excel AI. Answer using only the supplied workbook profile and findings. Be concise, practical, and call out exact sheet names when possible.'
                },
                {
                  role: 'user',
                  content: JSON.stringify(body)
                }
              ]
            }
          : body;

        const providerResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(providerBody)
        });

        const providerData = await providerResponse.json();
        if (!providerResponse.ok) {
          res.statusCode = providerResponse.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: providerData?.error?.message || 'AI provider request failed' }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            provider: isOpenAiResponses ? 'openai-responses' : 'custom',
            answer: extractText(providerData),
            raw: providerData
          })
        );
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected AI proxy error' }));
      }
    });
  }
});

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5177
  }
});
