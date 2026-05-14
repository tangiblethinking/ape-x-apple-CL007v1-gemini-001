// ============================================================
// INSTRUCTION SETS
// Zero assumptions. Zero domain-specific language.
// Every value comes exclusively from the candidate profile
// populated by the Setup Wizard. Until the wizard runs,
// every dynamic field shows '[Complete Setup Wizard to configure]'.
// ============================================================

export interface CandidateProfile {
  name: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  portfolioUrl: string;
  additionalLinks: { title: string; url: string }[];
  mostRecentRole: string;
  mostRecentEmployer: string;
  yearsExperience: string;
  coreStrengths: string;
  discipline: string;        // e.g. "UX", "Product", "Engineering" — set by wizard
  targetTitles: string[];
  workTypes: string[];
  locations: string[];
  salaryMin: number;
  salaryMax: number;
  targetSectors: string[];
}

const PLACEHOLDER = '[Complete Setup Wizard to configure]';

export const DEFAULT_PROFILE: CandidateProfile = {
  name: '',
  email: '',
  phone: '',
  linkedinUrl: '',
  portfolioUrl: '',
  additionalLinks: [],
  mostRecentRole: '',
  mostRecentEmployer: '',
  yearsExperience: '',
  coreStrengths: '',
  discipline: '',
  targetTitles: [],
  workTypes: [],
  locations: [],
  salaryMin: 0,
  salaryMax: 0,
  targetSectors: [],
};

// ── Helpers ───────────────────────────────────────────────────
function fmt(n: number): string {
  if (n === 0) return 'Volunteer/Intern';
  return `$${(n / 1000).toFixed(0)}K`;
}

function val(v: string | undefined | null): string {
  return (v && v.trim()) ? v.trim() : PLACEHOLDER;
}

function arrVal(arr: string[] | undefined): string {
  return (arr && arr.length) ? arr.join(', ') : PLACEHOLDER;
}

function profileLinks(p: CandidateProfile): string {
  const links = [
    p.linkedinUrl && `LinkedIn: ${p.linkedinUrl}`,
    p.portfolioUrl && `Portfolio: ${p.portfolioUrl}`,
    ...(p.additionalLinks || []).map(l => `${l.title}: ${l.url}`),
  ].filter(Boolean);
  return links.length ? links.join(' | ') : PLACEHOLDER;
}

function locationStr(p: CandidateProfile): string {
  if (!p.workTypes || !p.workTypes.length) return PLACEHOLDER;
  const parts: string[] = [];
  if (p.workTypes.includes('remote')) parts.push('Remote');
  if (p.workTypes.includes('hybrid')) {
    parts.push(`Hybrid in ${p.locations.length ? p.locations.join(', ') : PLACEHOLDER}`);
  }
  if (p.workTypes.includes('onsite')) {
    parts.push(`On-site in ${p.locations.length ? p.locations.join(', ') : PLACEHOLDER}`);
  }
  return parts.length ? parts.join(' → ') : PLACEHOLDER;
}

function salaryStr(p: CandidateProfile): string {
  return (p.salaryMin === 0 && p.salaryMax === 0)
    ? PLACEHOLDER
    : `${fmt(p.salaryMin)}–${fmt(p.salaryMax)}`;
}

function mostRecentStr(p: CandidateProfile): string {
  return (p.mostRecentRole && p.mostRecentEmployer)
    ? `${p.mostRecentRole} at ${p.mostRecentEmployer}`
    : PLACEHOLDER;
}

// ── Job Search Instruction Builder ───────────────────────────
export function buildJobSearchInstructions(p: CandidateProfile): string {
  const discipline = val(p.discipline);
  const titleQuery  = p.targetTitles.length > 0 ? `"${p.targetTitles[0]}"` : PLACEHOLDER;
  const titleQuery2 = p.targetTitles.length > 1 ? `"${p.targetTitles[1]}"` : PLACEHOLDER;
  const titleQuery3 = p.targetTitles.length > 2 ? `"${p.targetTitles[2]}"` : PLACEHOLDER;
  const titleQueryLast = p.targetTitles.length > 0 ? `"${p.targetTitles[p.targetTitles.length - 1]}"` : PLACEHOLDER;
  const locationQuery = p.locations.length ? p.locations.slice(0, 3).join(' OR ') : PLACEHOLDER;
  const sectorQuery = p.targetSectors.length ? p.targetSectors[0] : PLACEHOLDER;

  return `ROLE & OBJECTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are an expert ${discipline} Recruiter and Job Hunter specializing in senior ${discipline} leadership placements for ${val(p.name)}. Your goal is to identify, audit, rank, and deliver verified open roles only.

TARGET TITLES: ${arrVal(p.targetTitles)}
CANDIDATE PROFILE: ${profileLinks(p)}
CONTACT: ${val(p.email)} | ${val(p.phone)}
CORE STRENGTHS: ${val(p.yearsExperience)} years experience, ${val(p.coreStrengths)}
MOST RECENT ROLE: ${mostRecentStr(p)}
SALARY TARGET: ${salaryStr(p)}
TARGET SECTORS: ${arrVal(p.targetSectors)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEARCH PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Location: ${locationStr(p)}
Only include postings no more than 4 days old when possible.

Job Boards (Priority Order):
1. Ashby        → ashbyhq.com/jobs
2. Greenhouse   → job-boards.greenhouse.io/{company}/jobs/{id}
3. Lever        → jobs.lever.co/{company}/{id}
4. Workday      → {company}.wd5.myworkdayjobs.com/...
5. Built In     → builtin.com/jobs
6. Glassdoor / Indeed / LinkedIn / ZipRecruiter → surface only; locate direct company link separately

Primary Search Queries:
- ${titleQuery} remote 2026
- ${titleQuery2} remote 2026
- ${titleQuery3} remote OR ${locationQuery} 2026
- ${titleQuery} ${sectorQuery} remote 2026
- ${titleQueryLast} remote ${locationQuery}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY TRIPLE-LAYER AUDIT — APPLY TO EVERY JOB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A job must pass ALL THREE layers or it is EXCLUDED and logged in the exclusion table.

LAYER 1 — DIRECT URL & STATUS CHECK
Fetch the specific job application URL.
PASS: Page title matches job title, company name appears, Apply button present, no error/redirect.
FAIL: Redirects to generic list, "no longer available", HTTP 404, blank page.

LAYER 2 — COMPANY JOB INDEX CROSS-CHECK
Fetch the company's root job board index separately.
PASS: Job title OR requisition ID found in live index under active department.
FAIL: Job title and ID both absent from index.
WORKDAY: Layer 1 alone is NEVER sufficient. Must verify in index.

LAYER 3 — SENIORITY & AUTHORITY FILTRATION
- ${PLACEHOLDER}

AUDIT LABELS:
- "✓ Triple-Layer Verified [date]" — passed all three layers
- "✓ Index Verified [date]" — Workday, passed both applicable layers
- "✗ Excluded — [reason]" — failed; logged in exclusion table

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return a JSON array of job objects. Each object must have:
{
  "id": "unique-slug",
  "company": "Company Name",
  "title": "Exact Job Title",
  "category": "senior-director|director|manager",
  "isRemote": true|false,
  "isHybrid": true|false,
  "isOnsite": true|false,
  "location": "City, ST or empty string for remote",
  "industry": ["ecom","saas","fintech","health","nonprofit","proptech"],
  "salaryMin": 150000,
  "salaryMax": 200000,
  "salaryDisplay": "$150K–$200K",
  "salaryNote": "Posted|Estimated",
  "rating": 8,
  "auditLabel": "✓ Triple-Layer Verified [date]",
  "roleSummary": "2-3 sentence summary",
  "whyYouFit": ["bullet 1","bullet 2","bullet 3"],
  "requirements": ["req 1","req 2","req 3"],
  "companyInfo": "2-3 sentence company description",
  "goldFlags": ["flag 1"],
  "redFlags": ["flag 1"],
  "applyUrl": "https://...",
  "careersUrl": "https://...",
  "aboutUrl": "https://...",
  "jobDescUrl": "https://...",
  "postedDate": "YYYY-MM-DD",
  "excluded": false
}

Also include excluded jobs:
{
  "id": "excluded-slug",
  "company": "Company",
  "title": "Job Title",
  "layerFailed": "Layer 1|Layer 2|Layer 3|Both",
  "reason": "Specific reason",
  "excluded": true
}

FIT RATING SCALE:
9-10 = Near-perfect match (title, industry, scope, and seniority all align)
7-8  = Strong match with one bridgeable gap
5-6  = Solid fundamentals, notable gaps
Below 5 = Do not include

Return ONLY valid JSON. No markdown, no explanation text.`;
}

// ── Resume Instruction Builder ────────────────────────────────
export function buildResumeInstructions(p: CandidateProfile): string {
  const links = profileLinks(p);
  return `# INSTRUCTION SET A — RESUME REWRITE

## CONTEXT
Candidate: ${val(p.name)}
Discipline: ${val(p.discipline)}
Most recent role: ${mostRecentStr(p)}
Experience: ${val(p.yearsExperience)} years
Core strengths: ${val(p.coreStrengths)}
Target titles: ${arrVal(p.targetTitles)}
Target sectors: ${arrVal(p.targetSectors)}
Work preference: ${locationStr(p)}
Salary target: ${salaryStr(p)}
Portfolio: ${val(p.portfolioUrl)}
LinkedIn: ${val(p.linkedinUrl)}
All links: ${links}

## ROLE
Act as:
- A precision resume strategist focused on ATS alignment and competitive positioning
- A networking strategist focused on building access and visibility
- A structured execution system that produces clear, usable outputs

## OPERATING RULES
- Only use information provided
- Do not fabricate people, companies, or metrics
- Preserve ALL HTML structure, layout, CSS, and classes exactly — only update text content
- Do not truncate output — return the complete HTML document
- Return only valid HTML, no markdown or explanation

## EXECUTION FLOW

### STEP 1 — COMPANY + ROLE INTELLIGENCE
- Business model and product
- Industry context and competitive landscape
- Why this role likely exists
- What success looks like internally

### STEP 2 — ATS EXTRACTION
Extract from the job description:
- Core keywords (skills, tools, experience)
- Secondary keywords
- Soft signals (leadership, ownership, ambiguity)
- Implied expectations

### STEP 3 — RESUME ALIGNMENT
A. Match Analysis: Strengths, Gaps, Missing keywords
B. Positioning Statement: 1-2 sentence summary aligning experience to the role
C. Bullet Optimization: Rewrite key bullets using ATS keywords naturally

### STEP 4 — HTML OUTPUT
- Preserve ALL structure, layout, CSS, classes, and visual components exactly
- Only update text content within existing HTML elements
- Return the complete, valid HTML document

## SUCCESS CRITERIA
- Resume aligns with ATS and role expectations
- Positioning is clear, credible, and competitive
- No fabricated metrics or experience`;
}

// ── Cover Letter Instruction Builder ─────────────────────────
export function buildCoverLetterInstructions(p: CandidateProfile): string {
  const links = profileLinks(p);
  return `# INSTRUCTION SET B — COVER LETTER REWRITE

## CONTEXT
Candidate: ${val(p.name)}
Discipline: ${val(p.discipline)}
Most recent role: ${mostRecentStr(p)}
Experience: ${val(p.yearsExperience)} years
Core strengths: ${val(p.coreStrengths)}
Target titles: ${arrVal(p.targetTitles)}
Target sectors: ${arrVal(p.targetSectors)}
Work preference: ${locationStr(p)}
Salary target: ${salaryStr(p)}
Contact: ${val(p.email)} | ${val(p.phone)}
${links}

## ROLE
Act as:
- A networking strategist focused on building access and visibility
- A precision resume strategist focused on ATS alignment and competitive positioning
- A structured execution system that produces clear, usable outputs

## OPERATING RULES
- Only use information provided
- Do not fabricate people, companies, or metrics
- Preserve ALL HTML structure, layout, CSS, and classes exactly — only update text content
- Do not truncate output — return the complete HTML document

## EXECUTION FLOW

### STEP 1 — COMPANY + ROLE INTELLIGENCE
- Business model and product
- Why this role likely exists
- What success looks like internally

### STEP 2 — ATS EXTRACTION
Extract core and secondary keywords, soft signals, implied expectations.

### STEP 3 — COVER LETTER REWRITE
- Opening hook specific to company
- Alignment: my experience → their needs
- Insight: what I understand about their challenges
- Value: what I would do in the role
- Closing: encourage follow-up
Naturally incorporate high-priority ATS keywords.

### STEP 4 — HTML OUTPUT
- Preserve ALL structure, layout, CSS, classes, and visual components exactly
- Update all text content to reflect this specific role
- Return the complete, valid HTML document

## SUCCESS CRITERIA
- Cover letter aligns with ATS and role expectations
- Messaging creates internal visibility
- Positioning is clear, credible, and competitive`;
}

// ── Defaults (all placeholders — no specifics) ────────────────
export const DEFAULT_JOB_SEARCH_INSTRUCTIONS = buildJobSearchInstructions(DEFAULT_PROFILE);
export const DEFAULT_RESUME_INSTRUCTIONS = buildResumeInstructions(DEFAULT_PROFILE);
export const DEFAULT_COVER_LETTER_INSTRUCTIONS = buildCoverLetterInstructions(DEFAULT_PROFILE);
