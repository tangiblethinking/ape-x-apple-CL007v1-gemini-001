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
    // Gemini uses a different message format
    // System prompt goes as first user message with special formatting
    const contents = [];
    
    if (systemPrompt) {
      contents.push({
        role: 'user',
        parts: [{ text: `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n\n[END SYSTEM INSTRUCTIONS]\n\nPlease follow the system instructions above for all responses.` }]
      });
      contents.push({
        role: 'model',
        parts: [{ text: 'I understand and will follow the system instructions provided.' }]
      });
    }

    // Add actual messages
    for (const msg of messages) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      return { text: '', error: err.error?.message || 'Gemini API error' };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text, error: text ? undefined : 'Empty response from Gemini' };
  } catch (err: unknown) {
    return { text: '', error: err instanceof Error ? err.message : 'Unknown error' };
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
