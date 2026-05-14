import type { NextApiRequest, NextApiResponse } from 'next';
import { callAI, extractJSON, AIProvider } from '../../lib/ai-providers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { resumeText, apiKeyOverride, aiProvider } = req.body;
  const provider: AIProvider = aiProvider || 'claude';
  const apiKey = apiKeyOverride || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(400).json({ error: 'No API key configured.' });
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' });

  const systemPrompt = `You are a resume parser. Extract structured profile data from the resume text provided.

Return ONLY a valid JSON object with exactly these fields — no explanation, no markdown, no preamble:
{
  "name": "Full Name or empty string",
  "email": "email@example.com or empty string",
  "phone": "phone number or empty string",
  "linkedinUrl": "linkedin.com/in/username — strip https:// and www. or empty string",
  "portfolioUrl": "portfoliosite.com — strip https:// and www. or empty string",
  "additionalLinks": [{"title": "link label", "url": "full url"}],
  "mostRecentRole": "Most recent job title or empty string",
  "mostRecentEmployer": "Most recent company name or empty string",
  "yearsExperience": "Estimated total years of experience as a number string e.g. '12' or empty string",
  "coreStrengths": "Comma-separated list of 4-8 key skills and specialties extracted from resume or empty string",
  "discipline": "The candidate's primary professional discipline e.g. UX Design, Product Management, Software Engineering or empty string",
  "targetTitles": ["Array of 4-6 job titles — current level plus 3-5 titles one level more senior"],
  "targetSectors": ["Array of industry sectors relevant to the candidate based on their work history"],
  "salaryMin": 0,
  "salaryMax": 0,
  "additionalUrlsFound": ["any other URLs found in the resume beyond LinkedIn and portfolio"]
}

CRITICAL: Output ONLY the JSON object. No text before or after. No markdown code fences.`;

  try {
    const aiResponse = await callAI(
      provider,
      apiKey,
      [{ role: 'user', content: `Extract profile data from this resume:\n\n${resumeText.slice(0, 10000)}` }],
      systemPrompt,
      2000
    );

    if (aiResponse.error) {
      return res.status(500).json({ error: `AI extraction failed: ${aiResponse.error}` });
    }

    // Use robust JSON extractor — handles markdown fences, prose wrapping, etc.
    const jsonStr = extractJSON(aiResponse.text);

    let profile;
    try {
      profile = JSON.parse(jsonStr);
    } catch {
      // Return the raw text so the client can at least see what came back
      return res.status(500).json({
        error: 'Could not parse AI response as JSON. Try again.',
        rawResponse: aiResponse.text.slice(0, 500),
      });
    }

    return res.status(200).json({ profile });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
