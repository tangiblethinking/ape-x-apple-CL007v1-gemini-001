import type { NextApiRequest, NextApiResponse } from 'next';
import { extractStateCodes, validateLocationInput } from '../../lib/location-validator';

// JSON repair helper
function repairJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const arrayStart = s.indexOf('[');
  if (arrayStart === -1) return '[]';
  s = s.slice(arrayStart);
  let depth = 0, inString = false, escaped = false, lastCompleteObjectEnd = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') { depth--; if (depth === 1) lastCompleteObjectEnd = i; }
  }
  try { JSON.parse(s); return s; } catch { /* needs repair */ }
  if (lastCompleteObjectEnd > 0) {
    let truncated = s.slice(0, lastCompleteObjectEnd + 1).trim();
    truncated = truncated.replace(/,\s*$/, '');
    return truncated + ']';
  }
  return '[]';
}

function extractTitles(instructions: string): string[] {
  const match = instructions.match(/TARGET TITLES:\s*(.+)/);
  if (!match) return [];
  return match[1].split(',').map(t => t.trim()).filter(t => t && t !== '[Complete Setup Wizard to configure]');
}

function extractLocations(instructions: string): string[] {
  const match = instructions.match(/Location:\s*(.+)/);
  if (!match) return [];
  return extractStateCodes(match[1]);
}

function buildQueries(titles: string[], locations: string[]): string[] {
  if (!titles.length) return [];
  const currentYear = new Date().getFullYear();
  const queries: string[] = [];
  const locationStr = locations.length ? locations.slice(0, 3).join(' OR ') : 'Remote';
  const isRemote = locationStr.toLowerCase().includes('remote');
  for (const title of titles.slice(0, 4)) { queries.push(`"${title}" remote ${currentYear}`); }
  if (!isRemote && locations.length) {
    for (const title of titles.slice(0, 2)) { queries.push(`"${title}" ${locationStr} ${currentYear}`); }
  }
  for (const title of titles.slice(0, 2)) {
    queries.push(`site:greenhouse.io "${title}" ${currentYear}`);
    queries.push(`site:lever.co "${title}" ${currentYear}`);
  }
  return queries.slice(0, 8);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { instructions, specialInstructions, apiKeyOverride, serperKeyOverride } = req.body;
  const aiProvider: string = req.body.aiProvider || 'claude';

  const anthropicKey: string | undefined = aiProvider === 'claude' ? (apiKeyOverride || process.env.ANTHROPIC_API_KEY) : undefined;
  const geminiKey: string | undefined = aiProvider === 'gemini' ? (apiKeyOverride || process.env.GEMINI_API_KEY) : undefined;
  const serperKey = serperKeyOverride || process.env.SERPER_API_KEY;

  if (aiProvider === 'claude' && !anthropicKey)
    return res.status(400).json({ error: 'No Anthropic API key configured. Add it in Settings.' });
  if (aiProvider === 'gemini' && !geminiKey)
    return res.status(400).json({ error: 'No Gemini API key configured. Add it in Settings.' });
  if (!serperKey)
    return res.status(400).json({ error: 'No Serper API key configured. Add it in Settings.' });

  try {
    const userTitles = extractTitles(instructions);
    const locationRaw = (instructions.match(/Location:\s*(.+)/)?.[1] || '').trim();

    if (locationRaw && locationRaw.toLowerCase() !== 'remote') {
      const locValidation = validateLocationInput(locationRaw);
      if (!locValidation.valid) {
        return res.status(400).json({ error: locValidation.error });
      }
    }

    const userLocations = extractLocations(instructions);
    const searchQueries = buildQueries(userTitles, userLocations);
    const searchResults: string[] = [];

    for (const query of searchQueries) {
      try {
        const serperRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 10, tbs: 'qdr:w' }),
        });
        if (serperRes.ok) {
          const data = await serperRes.json();
          const results = (data.organic || []).map((r: { title: string; link: string; snippet: string }) =>
            `TITLE: ${r.title}\nURL: ${r.link}\nSNIPPET: ${r.snippet}`
          ).join('\n---\n');
          if (results) searchResults.push(`QUERY: "${query}"\nRESULTS:\n${results}`);
        }
      } catch { /* continue */ }
    }

    const combinedResults = searchResults.join('\n\n========\n\n');

    const finalInstructions = specialInstructions
      ? `${instructions}\n\n━━━━━━━━━━━━━━━━━━━━\nSPECIAL OVERRIDE INSTRUCTIONS FOR THIS SEARCH:\n${specialInstructions}\n━━━━━━━━━━━━━━━━━━━━`
      : instructions;

    const systemPromptFull = `${finalInstructions}

IMPORTANT: You have been given real search results from Google. Your job is to:
1. Parse these search results to identify genuine job postings matching the TARGET TITLES in these instructions
2. Apply the triple-layer audit protocol described in your instructions
3. For each candidate job, assess the URL pattern to determine if it's from a known ATS (Greenhouse, Lever, Workday, Ashby)
4. Apply Layer 3 seniority/authority filtration per the instructions
5. Rate each passing job for fit against the candidate profile
6. Return ONLY a valid JSON array — no markdown, no explanation, no code fences

CRITICAL JSON FIELDS — every job object MUST include:
- "isRemote": true|false
- "isHybrid": true|false
- "isOnsite": true|false
- "location": "City, ST" — for hybrid/onsite only, empty string for remote, "N/A" if not found

The search results are REAL and CURRENT. Trust URLs from greenhouse.io, lever.co, ashbyhq.com as high-confidence.
Flag aggregator re-posts (Indeed, LinkedIn, ZipRecruiter) and find direct company URLs if possible.
Today's date is ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.

The target titles searched were: ${userTitles.join(', ') || '[not configured]'}
Prioritize results that match these exact titles or very close variants.`;

    const userMessageContent = `Here are the live search results for the target titles. Process them per your instructions and return the JSON array:\n\n${combinedResults}`;

    let rawText = '[]';

    if (aiProvider === 'gemini') {
      // FIX BUG2: Gemini path
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userMessageContent }] }],
            systemInstruction: { parts: [{ text: systemPromptFull }] },
            generationConfig: { maxOutputTokens: 16000, temperature: 0.1 }
          }),
        }
      );
      if (!geminiRes.ok) {
        const err = await geminiRes.json();
        return res.status(geminiRes.status).json({ error: err.error?.message || 'Gemini API error' });
      }
      const geminiData = await geminiRes.json();
      rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    } else {
      // CLAUDE PATH (unchanged)
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 16000,
          system: systemPromptFull,
          messages: [{ role: 'user', content: userMessageContent }],
        }),
      });
      if (!claudeRes.ok) {
        const err = await claudeRes.json();
        return res.status(claudeRes.status).json({ error: err.error?.message || 'Claude API error' });
      }
      const claudeData = await claudeRes.json();
      rawText = claudeData.content?.[0]?.text || '[]';
    }

    const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let jobs;
    try {
      jobs = JSON.parse(cleaned);
    } catch {
      try {
        const repaired = repairJson(rawText);
        jobs = JSON.parse(repaired);
      } catch {
        return res.status(500).json({ error: 'Failed to parse job results. Try again.' });
      }
    }

    return res.status(200).json({ jobs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
