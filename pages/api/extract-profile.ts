import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { resumeText, apiKeyOverride } = req.body;
  const anthropicKey = apiKeyOverride || process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) return res.status(400).json({ error: 'No Anthropic API key configured.' });
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' });

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        system: `You are a resume parser. Extract structured profile data from the resume text provided.

Return ONLY a valid JSON object with exactly these fields:
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
  "discipline": "The candidate's primary professional discipline e.g. UX Design, Product Management, Software Engineering — infer from roles and skills or empty string",
  "targetTitles": ["Array of job titles the candidate should target — include their most recent title AND 3-5 titles one level more senior, based on standard career progression in their specific field. Infer entirely from their work history and roles. Return 4-6 titles total."],
  "targetSectors": ["Array of industry sectors relevant to the candidate based on their work history e.g. Fintech, Healthcare, SaaS, Retail. Infer from employers and roles only."],
  "salaryMin": 0,
  "salaryMax": 0,
  "additionalUrlsFound": ["any other URLs found in the resume beyond LinkedIn and portfolio"]
}

Rules:
- Use empty string "" for text fields not found, 0 for salary numbers not found
- For yearsExperience: calculate from work history dates if not stated explicitly
- For targetTitles: always include titles ONE LEVEL SENIOR to most recent role based on standard career progression in their specific field — do not assume any particular industry or domain
- For discipline: be specific to their actual field — infer only from their resume content, do not assume
- For targetSectors: infer from their employers and roles only — return empty array if unclear
- For salary: only populate if explicitly stated in resume, otherwise use 0
- Strip https:// and www. from linkedinUrl and portfolioUrl
- Return ONLY the JSON object, no markdown, no explanation`,
        messages: [
          { role: 'user', content: `Extract profile data from this resume:\n\n${resumeText.slice(0, 10000)}` },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(claudeRes.status).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await claudeRes.json();
    const raw = data.content?.[0]?.text || '{}';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let profile;
    try {
      profile = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse extracted profile data.' });
    }

    return res.status(200).json({ profile });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
