import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

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

const parseTranslationArray = (raw: string, expectedLength: number): string[] | null => {
  try {
    const cleaned = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length !== expectedLength) return null;
    if (!parsed.every((item) => typeof item === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
};

// Server-only settings for the dev proxy. Vite does not load .env files into
// process.env for the config's own runtime, so values from .env.local must
// come through loadEnv; process.env stays as a fallback for shell-set values.
// These are never exposed to client code.
const aiProxyPlugin = (env: Record<string, string>): Plugin => {
  const setting = (key: string): string => env[key] || process.env[key] || '';

  return {
  name: 'smart-excel-ai-proxy',
  configureServer(server) {
    server.middlewares.use('/api/translate', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await readJsonBody(req as RawRequest);
        const texts = Array.isArray(body.texts) ? body.texts.filter((item): item is string => typeof item === 'string') : [];
        const targetLanguage = typeof body.targetLanguage === 'string' ? body.targetLanguage : '';
        if (!texts.length || texts.length > 200 || !targetLanguage) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Expected texts (1-200 strings) and targetLanguage' }));
          return;
        }

        // Preferred: forward to the AIExcel backend translate route when it is running.
        const backendUrl = setting('AIEXCEL_BACKEND_URL');
        if (backendUrl) {
          const backendResponse = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/translate`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(setting('AIEXCEL_BACKEND_KEY') ? { authorization: `Bearer ${setting('AIEXCEL_BACKEND_KEY')}` } : {})
            },
            body: JSON.stringify({ texts, targetLanguage })
          });
          const backendData = await backendResponse.json();
          res.statusCode = backendResponse.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(backendData));
          return;
        }

        const apiUrl = setting('AI_API_URL') || (setting('OPENAI_API_KEY') ? 'https://api.openai.com/v1/responses' : '');
        const apiKey = setting('AI_API_KEY') || setting('OPENAI_API_KEY');
        if (!apiUrl || !apiKey) {
          res.statusCode = 501;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Translation provider is not configured. Falling back to the local dictionary.' }));
          return;
        }

        const isOpenAiResponses = apiUrl.includes('/v1/responses');
        const translationInstruction =
          'You translate spreadsheet cell values. Respond with ONLY a JSON array of translated strings, one per input value, in the same order. No explanation, no markdown fences. Preserve numbers, dates, currency symbols, amounts, codes, and identifiers exactly. If a value is already in the target language or cannot be translated, return it unchanged.';
        const translationRequest = `Translate the following spreadsheet values into ${targetLanguage}.\n\nValues (JSON array):\n${JSON.stringify(texts)}`;
        const providerBody = isOpenAiResponses
          ? {
              model: setting('OPENAI_MODEL') || setting('AI_MODEL') || 'gpt-4o-mini',
              input: [
                { role: 'system', content: translationInstruction },
                { role: 'user', content: translationRequest }
              ]
            }
          : { texts, targetLanguage, system: translationInstruction, prompt: translationRequest };

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
          res.end(JSON.stringify({ error: providerData?.error?.message || 'Translation provider request failed' }));
          return;
        }

        const translations = parseTranslationArray(extractText(providerData), texts.length);
        if (!translations) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Translation provider returned an unexpected format' }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ translations, cached: false }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected translate proxy error' }));
      }
    });

    server.middlewares.use('/api/ai', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await readJsonBody(req as RawRequest);

        // Preferred: forward to the AIExcel backend workbook-ask route when it is running.
        const backendUrl = setting('AIEXCEL_BACKEND_URL');
        if (backendUrl) {
          const backendResponse = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/workbook-ask`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(setting('AIEXCEL_BACKEND_KEY') ? { authorization: `Bearer ${setting('AIEXCEL_BACKEND_KEY')}` } : {})
            },
            body: JSON.stringify(body)
          });
          const backendData = await backendResponse.json();
          res.statusCode = backendResponse.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(backendData));
          return;
        }

        const apiUrl = setting('AI_API_URL') || (setting('OPENAI_API_KEY') ? 'https://api.openai.com/v1/responses' : '');
        const apiKey = setting('AI_API_KEY') || setting('OPENAI_API_KEY');

        if (!apiUrl || !apiKey) {
          res.statusCode = 501;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'AI provider is not configured. Falling back to local workbook tools.' }));
          return;
        }

        const isOpenAiResponses = apiUrl.includes('/v1/responses');
        const providerBody = isOpenAiResponses
          ? {
              model: setting('OPENAI_MODEL') || setting('AI_MODEL') || 'gpt-4o-mini',
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
  };
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), aiProxyPlugin(loadEnv(mode, process.cwd(), ''))],
  server: {
    host: '0.0.0.0',
    port: 5177
  }
}));
