import type { NextApiRequest, NextApiResponse } from 'next';

// Extract target titles from instruction text
function extractTitles(instructions: string): string[] {
  const match = instructions.match(/TARGET TITLES:\s*(.+)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(t => t.trim())
    .filter(t => t && t !== '[Complete Setup Wizard to configure]');
}

// Extract location preferences from instruction text
function extractLocations(instructions: string): string[] {
  const match = instructions.match(/Location:\s*(.+)/);
  if (!match) return [];
  const locStr = match[1];
  const states = locStr.match(/\b([A-Z]{2})\b/g) || [];
  return states;
}

// Build Serper queries from user's actual titles
function buildQueries(titles: string[], locations: string[]): string[] {
  if (!titles.length) return [
    '"Director" remote 2026',
    '"Manager" remote 2026',
    '"Lead" remote 2026',
  ];

  const queries: string[] = [];
  const locationStr = locations.length ? locations.slice(0, 3).join(' OR ') : 'Remote';
  const isRemote = locationStr.toLowerCase().includes('remote');

  for (const title of titles.slice(0, 4)) {
    queries.push(`"${title}" remote 2026`);
  }

  if (!isRemote && locations.length) {
    for (const title of titles.slice(0, 2)) {
      queries.push(`"${title}" ${locationStr} 2026`);
    }
  }

  for (const title of titles.slice(0, 2)) {
    queries.push(`site:greenhouse.io "${title}" 2026`);
    queries.push(`site:lever.co "${title}" 2026`);
  }

  return queries.slice(0, 8);
}

const AGGREGATOR_DOMAINS = [
  'linkedin.com', 'indeed.com', 'ziprecruiter.com', 'glassdoor.com',
  'monster.com', 'careerbuilder.com', 'dice.com', 'builtin.com',
  'simplyhired.com', 'snagajob.com', 'flexjobs.com', 'talent.com',
  'google.com', 'adzuna.com', 'joblist.com',
];

const TRUSTED_ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workday.com',
  'myworkdayjobs.com', 'icims.com', 'jobvite.com', 'smartrecruiters.com',
  'taleo.net', 'breezy.hr', 'recruitee.com',
];

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface TrustedResult {
  title: string;
  company: string;
  url: string;
  snippet: string;
  source: string;
}

interface AggregatorResult {
  title: string;
  company: string;
  aggregator_url: string;
  snippet: string;
  aggregator: string;
}

function classifyResult(r: SearchResult): { type: 'trusted' | 'aggregator' | 'skip'; domain: string } {
  let domain = '';
  try { domain = new URL(r.link).hostname.toLowerCase(); } catch { return { type: 'skip', domain: '' }; }

  if (TRUSTED_ATS_DOMAINS.some(d => domain.includes(d))) return { type: 'trusted', domain };
  if (AGGREGATOR_DOMAINS.some(d => domain.includes(d))) return { type: 'aggregator', domain };
  // Company career pages — treat as trusted
  if (domain.includes('careers.') || r.link.includes('/careers/') || r.link.includes('/jobs/')) return { type: 'trusted', domain };
  return { type: 'aggregator', domain };
}

function extractCompanyFromSnippet(title: string, snippet: string, domain: string): string {
  // Try to extract company from snippet or domain
  const domainParts = domain.replace('www.', '').split('.');
  if (domainParts.length >= 2 && !AGGREGATOR_DOMAINS.some(d => domain.includes(d))) {
    return domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
  }
  // Try "at Company" pattern in title or snippet
  const atMatch = (title + ' ' + snippet).match(/\bat\s+([A-Z][a-zA-Z\s&,.']+?)(?:\s*[-|·•,]|\s+in\s|\s+for\s|$)/);
  if (atMatch) return atMatch[1].trim();
  return 'Unknown';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { instructions, specialInstructions, apiKeyOverride, serperKeyOverride } = req.body;

  const anthropicKey = apiKeyOverride || process.env.ANTHROPIC_API_KEY;
  const serperKey = serperKeyOverride || process.env.SERPER_API_KEY;

  if (!anthropicKey) return res.status(400).json({ error: 'No Anthropic API key configured. Add it in Settings.' });
  if (!serperKey) return res.status(400).json({ error: 'No Serper API key configured. Add it in Settings.' });

  const userTitles = extractTitles(instructions);
  const userLocations = extractLocations(instructions);
  const searchQueries = buildQueries(userTitles, userLocations);

  const trusted: TrustedResult[] = [];
  const aggregators: AggregatorResult[] = [];

  for (const query of searchQueries) {
    try {
      const serperRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 10, tbs: 'qdr:w' }),
      });

      if (!serperRes.ok) continue;
      const data = await serperRes.json();
      const results: SearchResult[] = data.organic || [];

      for (const r of results) {
        const { type, domain } = classifyResult(r);
        if (type === 'skip') continue;

        const company = extractCompanyFromSnippet(r.title, r.snippet, domain);

        if (type === 'trusted') {
          // Avoid duplicates
          if (!trusted.find(t => t.url === r.link)) {
            trusted.push({
              title: r.title,
              company,
              url: r.link,
              snippet: r.snippet,
              source: domain,
            });
          }
        } else {
          if (!aggregators.find(a => a.aggregator_url === r.link)) {
            aggregators.push({
              title: r.title,
              company,
              aggregator_url: r.link,
              snippet: r.snippet,
              aggregator: domain,
            });
          }
        }
      }
    } catch {
      // Continue on individual search failure
    }
  }

  if (trusted.length === 0 && aggregators.length === 0) {
    return res.status(200).json({ error: 'no_results', message: 'No job postings found. Try adjusting your target titles or search settings.' });
  }

  return res.status(200).json({
    trusted,
    aggregators,
    titlesSearched: userTitles,
    queriesRun: searchQueries.length,
  });
}
