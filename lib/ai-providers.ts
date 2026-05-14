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
        model: 'claude-sonnet-4-20250514',
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

// ── Gemini API ──────────────────────────────────────────────
async function callGeminiAPI(
  apiKey: string,
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens = 16000
): Promise<AIResponse> {
  try {
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      const msg = err.error?.message || `Gemini API error (${response.status})`;
      return { text: '', error: msg };
    }

    const data = await response.json();

    // Check for safety blocks or empty candidates
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return { text: '', error: 'Gemini returned no candidates — check API key or try again' };
    }
    if (candidate.finishReason === 'SAFETY') {
      return { text: '', error: 'Gemini blocked response due to safety filters' };
    }

    const text = candidate.content?.parts?.[0]?.text || '';
    if (!text) {
      return { text: '', error: 'Empty response from Gemini' };
    }
    return { text };
  } catch (err: unknown) {
    return { text: '', error: err instanceof Error ? err.message : 'Unknown Gemini error' };
  }
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
