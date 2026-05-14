// ============================================================
// AI PROVIDER ABSTRACTION LAYER
// ============================================================
// Supports both Claude (Anthropic) and Gemini (Google) APIs

import type { AIProvider } from './storage';

// Re-export AIProvider type for convenience
export type { AIProvider };

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text: string;
  error?: string;
}

// ── Claude API ──────────────────────────────────────────────
async function callClaudeAPI(
  apiKey: string,
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens = 16000
): Promise<AIResponse> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return { text: '', error: err.error?.message || 'Claude API error' };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return { text, error: text ? undefined : 'Empty response from Claude' };
  } catch (err: unknown) {
    return { text: '', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Gemini Model Resolution ─────────────────────────────────
// Cache resolved model per API key (module-level, lives for server instance lifetime)
const geminiModelCache = new Map<string, string>();

// Preferred models in priority order. Flash variants first because they have
// far higher free-tier quotas (Pro is heavily rate-limited or gated on free tier).
// Pro is only reached on paid tiers or as last resort.
const GEMINI_PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-pro-latest',
];
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';

interface GeminiModelInfo {
  name: string; // e.g. "models/gemini-2.5-pro"
  supportedGenerationMethods?: string[];
}

interface ResolveResult {
  model: string;
  error?: string;
}

async function resolveGeminiModel(apiKey: string, excludeModels: string[] = []): Promise<ResolveResult> {
  // 1. Cache hit (skip if cached model is in exclusion list)
  const cached = geminiModelCache.get(apiKey);
  if (cached && !excludeModels.includes(cached)) return { model: cached };

  // 2. Call ListModels
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: 'GET' }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody.error?.message || `ListModels HTTP ${res.status}`;
      // Use fallback but surface the error so caller can decide
      const fallback = excludeModels.includes(GEMINI_FALLBACK_MODEL) ? 'gemini-2.5-flash-lite' : GEMINI_FALLBACK_MODEL;
      geminiModelCache.set(apiKey, fallback);
      return { model: fallback, error: `Model discovery failed: ${errMsg}. Using fallback ${fallback}.` };
    }

    const data = await res.json();
    const models: GeminiModelInfo[] = data.models || [];

    // Filter to models that support generateContent
    const capable = models.filter(m =>
      (m.supportedGenerationMethods || []).includes('generateContent')
    );

    if (capable.length === 0) {
      geminiModelCache.set(apiKey, GEMINI_FALLBACK_MODEL);
      return { model: GEMINI_FALLBACK_MODEL, error: `No Gemini models support generateContent for this key. Using fallback.` };
    }

    // Strip "models/" prefix from names for comparison
    const capableNames = capable.map(m => m.name.replace(/^models\//, ''));

    // Find first preferred model that is available AND not excluded
    for (const preferred of GEMINI_PREFERRED_MODELS) {
      if (capableNames.includes(preferred) && !excludeModels.includes(preferred)) {
        geminiModelCache.set(apiKey, preferred);
        return { model: preferred };
      }
    }

    // No preferred match — take first available non-excluded capable model
    const firstAvailable = capableNames.find(n => !excludeModels.includes(n));
    if (!firstAvailable) {
      return { model: '', error: `All available Gemini models have been tried and failed (excluded: ${excludeModels.join(', ')})` };
    }
    geminiModelCache.set(apiKey, firstAvailable);
    return { model: firstAvailable };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown ListModels error';
    geminiModelCache.set(apiKey, GEMINI_FALLBACK_MODEL);
    return { model: GEMINI_FALLBACK_MODEL, error: `ListModels exception: ${msg}. Using fallback.` };
  }
}

// ── Gemini API ──────────────────────────────────────────────
async function callGeminiAPI(
  apiKey: string,
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens = 16000
): Promise<AIResponse> {
  // Try up to N times, excluding models that hit quota errors
  const triedModels: string[] = [];
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Resolve which model to use (cached after first call, retries skip exhausted models)
      const { model, error: resolveError } = await resolveGeminiModel(apiKey, triedModels);

      if (!model) {
        return { text: '', error: resolveError || 'No Gemini model available' };
      }

      const contents = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.2, // Low temp for reliable JSON output
        },
      };

      // Use Gemini's native systemInstruction field — far more reliable than injecting into messages
      if (systemPrompt) {
        body.systemInstruction = {
          parts: [{ text: systemPrompt }],
        };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const apiMsg = err.error?.message || `Gemini API error (${response.status})`;
        const status = err.error?.status || '';

        // Detect quota / rate limit errors — retry with next model
        const isQuotaError = response.status === 429
          || status === 'RESOURCE_EXHAUSTED'
          || /quota|rate limit|exceeded/i.test(apiMsg);

        if (isQuotaError && attempt < maxAttempts - 1) {
          // Mark this model as exhausted, invalidate cache, try next
          triedModels.push(model);
          geminiModelCache.delete(apiKey);
          continue;
        }

        // Model not found — also retry with next model
        if (response.status === 404 && attempt < maxAttempts - 1) {
          triedModels.push(model);
          geminiModelCache.delete(apiKey);
          continue;
        }

        // Out of retries or non-retryable error
        const triedNote = triedModels.length > 0 ? ` (tried: ${triedModels.join(', ')})` : '';
        const combined = resolveError
          ? `${apiMsg} | ${resolveError}${triedNote}`
          : `${apiMsg} (model: ${model})${triedNote}`;
        return { text: '', error: combined };
      }

      const data = await response.json();

      // Check for safety blocks or empty candidates
      const candidate = data.candidates?.[0];
      if (!candidate) {
        return { text: '', error: `Gemini returned no candidates (model: ${model}) — check API key or try again` };
      }
      if (candidate.finishReason === 'SAFETY') {
        return { text: '', error: 'Gemini blocked response due to safety filters' };
      }

      const text = candidate.content?.parts?.[0]?.text || '';
      if (!text) {
        return { text: '', error: `Empty response from Gemini (model: ${model})` };
      }
      return { text };
    } catch (err: unknown) {
      // Network/parse error — don't retry, just return
      return { text: '', error: err instanceof Error ? err.message : 'Unknown Gemini error' };
    }
  }

  return { text: '', error: `All Gemini models exhausted after ${maxAttempts} attempts (tried: ${triedModels.join(', ')})` };
}

// ── Unified API Call ────────────────────────────────────────
export async function callAI(
  provider: AIProvider,
  apiKey: string,
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens = 16000
): Promise<AIResponse> {
  if (provider === 'claude') {
    return callClaudeAPI(apiKey, messages, systemPrompt, maxTokens);
  } else {
    return callGeminiAPI(apiKey, messages, systemPrompt, maxTokens);
  }
}

// ── JSON Extraction Helper ──────────────────────────────────
// Robustly extracts JSON from a response that may contain markdown fences,
// explanatory text, or other noise. Tries multiple strategies in order.
export function extractJSON(raw: string): string {
  if (!raw) return '{}';

  // 1. Strip markdown code fences
  let cleaned = raw.replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/```\s*$/im, '').trim();

  // 2. Try direct parse first
  try { JSON.parse(cleaned); return cleaned; } catch { /* continue */ }

  // 3. Find first { ... } block (handles leading/trailing prose)
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try { JSON.parse(candidate); return candidate; } catch { /* continue */ }
  }

  // 4. Find first [ ... ] block (array responses)
  const aStart = cleaned.indexOf('[');
  const aEnd = cleaned.lastIndexOf(']');
  if (aStart !== -1 && aEnd !== -1 && aEnd > aStart) {
    const candidate = cleaned.slice(aStart, aEnd + 1);
    try { JSON.parse(candidate); return candidate; } catch { /* continue */ }
  }

  return '{}';
}

// ── Validation Helpers ──────────────────────────────────────
export function validateAPIKey(provider: AIProvider, key: string): boolean {
  if (provider === 'claude') {
    return key.startsWith('sk-ant-') && key.length > 20;
  } else {
    // Gemini keys start with "AIza" and are typically 39 characters
    return key.startsWith('AIza') && key.length > 30;
  }
}

export function getAPIKeyPlaceholder(provider: AIProvider): string {
  return provider === 'claude' ? 'sk-ant-api03-...' : 'AIzaSy...';
}

export function getAPIKeyNote(provider: AIProvider): string {
  if (provider === 'claude') {
    return 'Key must start with "sk-ant-" — check that you copied the full key';
  } else {
    return 'Key must start with "AIza" — check that you copied the full key';
  }
}

export function getProviderName(provider: AIProvider): string {
  return provider === 'claude' ? 'Claude (Anthropic)' : 'Gemini (Google)';
}

export function getProviderSetupURL(provider: AIProvider): string {
  return provider === 'claude' 
    ? 'https://console.anthropic.com/settings/keys'
    : 'https://aistudio.google.com/app/apikey';
}

export function getProviderSetupSteps(provider: AIProvider): string[] {
  if (provider === 'claude') {
    return [
      'Go to console.anthropic.com/settings/keys in a new tab',
      'Sign in or create a free Anthropic account',
      'Click "Create Key" — name it anything (e.g. "job-hunt")',
      'Copy the key — it starts with sk-ant-',
      'Add a small amount of credit ($5–$10) under Billing — required to use the API',
      'Paste the key below'
    ];
  } else {
    return [
      'Go to aistudio.google.com/app/apikey in a new tab',
      'Sign in with your Google account',
      'Click "Create API Key" and select a Google Cloud project (or create one)',
      'Copy the API key — it starts with AIza',
      'Paste it below — Gemini has a generous free tier',
    ];
  }
}
