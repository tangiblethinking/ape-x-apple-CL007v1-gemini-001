import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company, title, applyUrl, jobDescUrl, careersUrl, candidateProfile, jdText, apiKeyOverride } = req.body;
  const anthropicKey = apiKeyOverride || process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) return res.status(400).json({ error: 'No Anthropic API key configured.' });

  // Try to fetch JD from URL if no text provided
  let jobContent = jdText || '';

  if (!jobContent && (jobDescUrl || applyUrl)) {
    const urlToTry = jobDescUrl || applyUrl;
    try {
      const fetchRes = await fetch(urlToTry, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBoardBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (fetchRes.ok) {
        const html = await fetchRes.text();
        // Strip HTML tags for a rough text extract
        jobContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
      }
    } catch {
      // URL fetch failed — will generate from profile only
      jobContent = '';
    }
  }

  const profileStr = candidateProfile ? JSON.stringify(candidateProfile) : '{}';
  const hasContent = jobContent.length > 100;

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
        max_tokens: 4000,
        system: `You are a recruiter analyst. Generate a complete job card analysis for the role described.
The candidate profile is: ${profileStr}

Return ONLY a valid JSON object with exactly these fields:
{
  "category": "senior-director|director|manager",
  "isRemote": true|false,
  "isHybrid": true|false,
  "isOnsite": true|false,
  "location": "City, ST or N/A — only for hybrid/onsite roles, empty string for remote",
  "industry": ["ecom"|"saas"|"fintech"|"health"|"nonprofit"|"proptech"],
  "salaryMin": 120000,
  "salaryMax": 180000,
  "salaryDisplay": "$120K–$180K",
  "salaryNote": "Estimated",
  "rating": 7,
  "roleSummary": "2-3 sentence summary of the role",
  "whyYouFit": ["bullet 1 specific to candidate profile", "bullet 2", "bullet 3"],
  "requirements": ["requirement 1", "requirement 2", "requirement 3"],
  "companyInfo": "2-3 sentences about the company",
  "goldFlags": ["positive signal if any"],
  "redFlags": ["concern if any"]
}

Rating scale: 9-10 near-perfect, 7-8 strong with minor gap, 5-6 solid fundamentals, below 5 = rate as 5.
If you have limited information, make reasonable estimates based on the company name, role title, and candidate profile.
Return ONLY the JSON object. No markdown, no explanation.`,
        messages: [{
          role: 'user',
          content: `Company: ${company}\nJob Title: ${title}\nApply URL: ${applyUrl || 'N/A'}\nJob Description URL: ${jobDescUrl || 'N/A'}\nCareers URL: ${careersUrl || 'N/A'}\n\n${hasContent ? `Job Content Extracted:\n${jobContent}` : 'No job description available — generate from company name and title only.'}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(claudeRes.status).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await claudeRes.json();
    const raw = data.content?.[0]?.text || '{}';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse analysis.' });
    }

    return res.status(200).json({ analysis, urlFetchSuccess: hasContent });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
