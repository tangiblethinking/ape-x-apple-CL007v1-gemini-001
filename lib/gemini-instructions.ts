// ============================================================
// GEMINI SYSTEM PROMPTS
// Authored for Gemini 2.5 Flash's processing characteristics:
// - Performs best with direct, unambiguous task framing
// - Requires explicit JSON schema — responds poorly to prose-described schemas
// - Needs clear separation between instruction and data
// - Benefits from positive framing (what TO do) over negative (what NOT to do)
// - systemInstruction field used natively via ai-providers.ts callGeminiAPI
// - Compact prompts reduce RPD usage on free tier
// ============================================================

// ── Pass 2: Job Card Builder ─────────────────────────────────
export function getGeminiSearchPrompt(
  userInstructions: string,
  specialInstructions: string | null,
  titlesSearched: string[],
  today: string
): string {
  const special = specialInstructions
    ? `\nSPECIAL INSTRUCTIONS: ${specialInstructions}`
    : '';

  // FIX BUG 1: Dynamic text injection to avoid dropping empty title queries down a broken fallback path
  const titlesListText = titlesSearched.length > 0
    ? titlesSearched.join(', ')
    : 'Any role relevant to the target career track and skill set embedded in the user profile context';

  // FIX BUG 2: Contextualizing instructions for Flash so it handles structural synonym matching gracefully
  const evaluationStep2Text = titlesSearched.length > 0
    ? '2. Confirm the title matches, is a close variant, or is a semantic synonym of the TITLES listed above (allow adjacent levels, synonyms, and discipline variations)'
    : '2. Confirm the title matches the candidate\'s professional track, core disciplines, or skill competencies semantically';

  return `${userInstructions}${special}

DATE: ${today}
TITLES: ${titlesListText}

TASK: Convert job search results into structured job card objects.

INPUT FORMAT: Each result is prefixed [ATS], [AGG-V], or [AGG-U] followed by Company|Title|URL|Snippet.

EVALUATION STEPS:
1. Confirm the result is an active job posting (not a news article, press release, or generic careers page)
${evaluationStep2Text}
3. Confirm seniority is appropriate — exclude clearly junior or executive-level mismatches
4. Assign a rating: 9-10 (near-perfect match), 7-8 (strong with one gap), 5-6 (solid with gaps), below 5 (exclude)

OUTPUT: Output format is constrained by the response schema. Populate every field for passing jobs. For excluded jobs, set excluded=true and populate id, company, title, layerFailed, reason.

auditLabel values: "✓ Direct ATS Verified ${today}" for [ATS] | "✓ Company Domain Verified ${today}" for [AGG-V] | "✓ Aggregator Listed ${today}" for [AGG-U]

Output the JSON only.`;
}

// ── Profile Extractor ────────────────────────────────────────
export function getGeminiExtractProfilePrompt(): string {
  return `TASK: Extract structured profile data from the resume and return a single JSON object that matches the response schema exactly.

STEP-BY-STEP EXTRACTION PROTOCOL:
1. Read the entire resume top to bottom before extracting any field.
2. For each field, search the resume text for the value. If the value is not present in the resume, output the empty default (empty string "" for strings, empty array [] for arrays, 0 for numbers).
3. For URL fields (linkedinUrl, portfolioUrl, additionalLinks), the URL must appear verbatim in the resume text. If no URL is present, output "". Do not construct URLs from the candidate name or employer.
4. After confirming a URL is present verbatim, strip the "https://" and "www." prefix. Keep the rest exactly as written.
5. For targetTitles, list the candidate's current job-title level plus 3-5 next-step senior titles in the SAME discipline.
6. For yearsExperience, calculate the year span between the earliest and most recent role and return it as a numeric string (e.g. "12").
7. For salaryMin and salaryMax, output 0 unless compensation is explicitly written in the resume.
8. For additionalLinks, include any non-LinkedIn, non-portfolio URLs found in the resume (GitHub, Behance, Dribbble, Medium, personal blog, etc.). Each item is {"title": "short label", "url": "verbatim url with https:// and www. stripped"}. Output an empty array [] if none found.

REQUIRED FIELDS (must be present in output):
- name: candidate full name (string)
- email: email address verbatim from resume (string)
- skills: array of technical or professional skills explicitly listed (array of strings)

ADDITIONAL FIELDS TO POPULATE:
- phone: phone number verbatim (string)
- linkedinUrl: LinkedIn URL verbatim, prefix-stripped (string)
- portfolioUrl: portfolio or personal site URL verbatim, prefix-stripped (string)
- additionalLinks: other links found in resume (array of {title, url})
- mostRecentRole: most recent job title (string)
- mostRecentEmployer: most recent company name (string)
- yearsExperience: total years experience as numeric string (string)
- coreStrengths: short summary of strengths from resume content (string)
- discipline: primary field (e.g. "Product Design") (string)
- targetTitles: 3-5 job titles to target (array of strings)
- targetSectors: industries the candidate has worked in (array of strings)
- salaryMin: minimum salary if stated, else 0 (number)
- salaryMax: maximum salary if stated, else 0 (number)

OUTPUT: Single JSON object matching the response schema. No markdown, no explanation, no preamble.`;
}

// ── Job Analyzer ─────────────────────────────────────────────
export function getGeminiAnalyzeJobPrompt(profileStr: string): string {
  return `TASK: Analyze a job opportunity against a candidate profile and return a structured job card.

Candidate profile: ${profileStr}

Rating: 9-10 near-perfect alignment | 7-8 strong with one gap | 5-6 solid with multiple gaps | minimum rating is 5

Output this JSON object only — no markdown, no explanation:
{"category":"director|senior-director|manager|vp|ic","isRemote":false,"isHybrid":false,"isOnsite":false,"location":"City ST or empty","industry":["sector"],"salaryMin":0,"salaryMax":0,"salaryDisplay":"$0 — Not Listed","salaryNote":"Not Listed","rating":7,"roleSummary":"2-3 sentences about role scope","whyYouFit":["specific fit point 1","specific fit point 2","specific fit point 3"],"requirements":["requirement 1","requirement 2","requirement 3"],"companyInfo":"2-3 sentences about company","goldFlags":["positive signal"],"redFlags":["concern"]}`;
}

// ── Document Generator ───────────────────────────────────────
export function getGeminiGeneratePrompt(
  type: 'resume' | 'coverLetter',
  userInstructions: string
): string {
  return `${userInstructions}

TASK: Generate a tailored ${type === 'resume' ? 'resume' : 'cover letter'} by updating the text content of the provided HTML template.

Rules:
1. Output the complete HTML document and nothing else
2. Do not add markdown code fences or any text outside the HTML
3. Keep all HTML elements, CSS classes, styles, and inline SVG exactly as-is
4. Change text content only — do not restructure, add, or remove elements
5. Output the full document from opening to closing tag — do not truncate
6. Tailor content specifically to the company and role described`;
}
