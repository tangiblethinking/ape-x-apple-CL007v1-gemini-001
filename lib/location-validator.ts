// ============================================================
// LOCATION VALIDATOR — Shared utility for US state validation
// ============================================================

export const US_STATE_MAP: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY',
};

export const ALL_50_STATES: string[] = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

// USA synonyms — any of these expand to all 50 states
const USA_SYNONYMS = /\b(usa|us|america|united states|united states of america)\b/i;

// ── Validate a single location entry ────────────────────────
export function validateLocationInput(input: string): { valid: boolean; error?: string } {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // Empty or "Remote" → always valid
  if (!lower || lower === 'remote') return { valid: true };

  // USA synonyms → valid
  if (USA_SYNONYMS.test(lower)) return { valid: true };

  // Check for valid 2-letter state abbreviation anywhere in input
  const abbrevMatches = trimmed.match(/\b([A-Za-z]{2})\b/g) || [];
  const hasValidAbbrev = abbrevMatches.some(a => ALL_50_STATES.includes(a.toUpperCase()));
  if (hasValidAbbrev) return { valid: true };

  // Check for full state name anywhere in input
  const hasValidName = Object.keys(US_STATE_MAP).some(name => lower.includes(name));
  if (hasValidName) return { valid: true };

  // Nothing recognized
  return {
    valid: false,
    error: 'Format: "City, State" or "State" or "USA, America, United States of America, US" accepted',
  };
}

// ── Validate all locations in a list ────────────────────────
export function validateAllLocations(locations: string[]): { valid: boolean; error?: string } {
  for (const loc of locations) {
    const result = validateLocationInput(loc);
    if (!result.valid) return result;
  }
  return { valid: true };
}

// ── Extract state codes from a location string ──────────────
export function extractStateCodes(input: string): string[] {
  const lower = input.toLowerCase().trim();

  if (!lower || lower === 'remote') return [];

  // USA synonyms → all 50
  if (USA_SYNONYMS.test(lower)) return ALL_50_STATES;

  const states = new Set<string>();

  // Full state names
  Object.entries(US_STATE_MAP).forEach(([name, abbr]) => {
    if (lower.includes(name)) states.add(abbr);
  });

  // 2-letter abbreviations — only add if valid state code
  const abbrevMatches = input.match(/\b([A-Za-z]{2})\b/g) || [];
  abbrevMatches.forEach(a => {
    const upper = a.toUpperCase();
    if (ALL_50_STATES.includes(upper)) states.add(upper);
  });

  return Array.from(states);
}
