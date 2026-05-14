import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, jobData, jobDescription, instructions, apiKeyOverride, uploadedTemplate } = req.body;

  const anthropicKey = apiKeyOverride || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ error: 'No Anthropic API key configured.' });

  // Prefer user-uploaded template from localStorage (passed in request body)
  // Fall back to blank public template shell
  let template = '';
  if (uploadedTemplate && uploadedTemplate.trim().length > 100) {
    template = uploadedTemplate;
  } else {
    const templateFile = type === 'resume' ? 'resume-template.html' : 'coverletter-template.html';
    const templatePath = path.join(process.cwd(), 'public', templateFile);
    try {
      template = fs.readFileSync(templatePath, 'utf-8');
    } catch {
      return res.status(500).json({ error: `Could not load ${templateFile} template.` });
    }
  }

  const jobDesc = jobDescription || `
Company: ${jobData.company}
Job Title: ${jobData.title}
Role Summary: ${jobData.roleSummary}
Requirements: ${jobData.requirements?.join(', ')}
Key Details: ${jobData.whyYouFit?.join(', ')}
Apply URL: ${jobData.applyUrl}
  `.trim();

  const systemPrompt = `${instructions}

You are generating a tailored ${type === 'resume' ? 'resume' : 'cover letter'} HTML file.

CRITICAL RULES:
1. Return ONLY the complete, valid HTML document — nothing else
2. Do NOT include markdown code fences, explanations, or any text outside the HTML
3. Preserve 100% of the HTML structure, CSS styles, classes, and inline SVG icons
4. Only change TEXT CONTENT within existing HTML elements
5. Do not add or remove any HTML elements, classes, or attributes
6. Do not truncate — return the entire document
7. The output must be a complete, standalone HTML file that renders identically to the template in layout

The HTML template is provided. Update only the text content to be tailored for this specific job application.`;

  const userMessage = `
COMPANY: ${jobData.company}
JOB TITLE: ${jobData.title}

JOB DESCRIPTION:
${jobDesc}

HTML TEMPLATE TO UPDATE:
${template}

Generate the complete tailored HTML. Return only the HTML document.`;

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
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(claudeRes.status).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await claudeRes.json();
    let html = data.content?.[0]?.text || '';

    // Strip any accidental markdown fences
    html = html.replace(/^```html\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

    if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
      return res.status(500).json({ error: 'Generated output does not appear to be valid HTML.' });
    }

    return res.status(200).json({ html });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
