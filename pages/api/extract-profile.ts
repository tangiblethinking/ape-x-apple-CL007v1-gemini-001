import type { NextApiRequest, NextApiResponse } from 'next';
import { callAI, callAIWithFileSearch, callClaudeWithTool, extractJSON, AIProvider, GEMINI_PROFILE_SCHEMA } from '../../lib/ai-providers';
import { getClaudeExtractProfilePrompt, CLAUDE_EXTRACT_PROFILE_TOOL } from '../../lib/claude-instructions';
import { getGeminiExtractProfilePrompt } from '../../lib/gemini-instructions';

interface ExtractProfileResponse {
  profile?: Record<string, unknown>;
  error?: string;
  details?: string;
  rawResponse?: string;
}

const REQUIRED_PROFILE_FIELDS = ['name', 'email'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExtractProfileResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fileId, resumeText, apiKeyOverride, aiProvider } = req.body;
  const provider: AIProvider = aiProvider || 'claude';
  const envKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const apiKey = apiKeyOverride || envKey;

  if (!apiKey) {
    return res.status(400).json({
      error: 'No API key configured',
      details: 'Add your API key in Settings',
    });
  }

  // ── Gemini File Search path (PDF/file-based extraction) ──
  if (fileId) {
    if (provider !== 'gemini') {
      return res.status(400).json({
        error: 'File Search is only supported with Gemini',
        details: 'Switch to Gemini provider to use uploaded resume',
      });
    }

    const systemPrompt = getGeminiExtractProfilePrompt();

    // Forward embedded hyperlinks extracted by parse-resume (pdfjs-dist annotations)
    // that Gemini's native PDF reader cannot see in the text layer
    let linksSuffix = '';
    if (resumeText) {
      const marker = '\n\nEMBEDDED LINKS:\n';
      const idx = resumeText.indexOf(marker);
      if (idx !== -1) {
        linksSuffix = resumeText.slice(idx);
      }
    }

    const extractionQuery = `Analyze the attached resume file and extract every field defined in the response schema. Follow the step-by-step extraction protocol from your system instructions. Output a single JSON object only.${linksSuffix ? '\n\nThe following embedded hyperlinks were found in the document but may not be visible in the PDF text layer:' + linksSuffix : ''}`;

    try {
      const aiResponse = await callAIWithFileSearch(
        provider,
        apiKey,
        fileId,
        extractionQuery,
        systemPrompt,
        4000,
        GEMINI_PROFILE_SCHEMA
      );

      if (aiResponse.error) {
        return res.status(500).json({
          error: 'File Search extraction failed',
          details: aiResponse.error,
        });
      }

      const jsonStr = extractJSON(aiResponse.text);
      let profile;
      try {
        profile = JSON.parse(jsonStr);
      } catch {
        return res.status(500).json({
          error: 'Could not parse File Search response as JSON',
          details: 'Resume may not have been processed correctly. Try re-uploading.',
          rawResponse: aiResponse.text.slice(0, 500),
        });
      }

      for (const field of REQUIRED_PROFILE_FIELDS) {
        if (!profile[field]) {
          return res.status(400).json({
            error: 'Extraction incomplete',
            details: `Missing required field: ${field}. Try uploading plain text or HTML resume.`,
            rawResponse: JSON.stringify(profile).slice(0, 500),
          });
        }
      }

      return res.status(200).json({ profile });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({
        error: 'Server error during File Search extraction',
        details: message,
      });
    }
  }

  // ── Plain text extraction path ──
  if (!resumeText) {
    return res.status(400).json({
      error: 'No resume provided',
      details: 'Either upload a resume file or provide resume text',
    });
  }

  try {
    let rawResponseText: string;
    let extractError: string | undefined;

    if (provider === 'claude') {
      // CLAUDE PATH: Use forced tool_use for schema-constrained extraction.
      const systemPrompt = getClaudeExtractProfilePrompt();
      const userMsg = `Extract profile data from this resume by calling the extract_profile tool. Remember: URLs must appear verbatim in the resume — never guess.\n\n--- RESUME START ---\n${resumeText.slice(0, 12000)}\n--- RESUME END ---`;
      const r = await callClaudeWithTool(apiKey, userMsg, systemPrompt, CLAUDE_EXTRACT_PROFILE_TOOL, 4000);
      rawResponseText = r.text;
      extractError = r.error;
    } else {
      // GEMINI PATH: Use responseSchema (profile schema explicitly attached).
      const systemPrompt = getGeminiExtractProfilePrompt();

      const marker = '\n\nEMBEDDED LINKS:\n';
      let processedText = resumeText;

      if (resumeText.includes(marker)) {
        const parts = resumeText.split(marker);
        const mainText = parts[0];
        const linksSection = parts.slice(1).join(marker);
        processedText = `${mainText.slice(0, 50000)}${marker}${linksSection}`;
      } else {
        processedText = resumeText.slice(0, 50000);
      }

      const r = await callAI(
        provider,
        apiKey,
        [{
          role: 'user',
          content: `Extract profile data from this resume:\n\n${processedText}`,
        }],
        systemPrompt,
        4000,
        GEMINI_PROFILE_SCHEMA
      );
      rawResponseText = r.text;
      extractError = r.error;
    }

    if (extractError) {
      return res.status(500).json({
        error: 'AI extraction failed',
        details: extractError,
      });
    }

    const jsonStr = extractJSON(rawResponseText);

    let profile;
    try {
      profile = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({
        error: 'Could not parse AI response as JSON',
        details: 'Try uploading a clearer resume or different format',
        rawResponse: rawResponseText.slice(0, 500),
      });
    }

    for (const field of REQUIRED_PROFILE_FIELDS) {
      if (!profile[field]) {
        return res.status(400).json({
          error: 'Extraction incomplete',
          details: `Missing required field: ${field}. Try a different resume format.`,
          rawResponse: JSON.stringify(profile).slice(0, 500),
        });
      }
    }

    return res.status(200).json({ profile });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({
      error: 'Server error during extraction',
      details: message,
    });
  }
}
