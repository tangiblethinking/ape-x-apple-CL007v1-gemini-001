// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================

export interface AppliedJob {
  id: string;
  company: string;
  title: string;
  appliedAt: string; // ISO date
  resumeGenerated: boolean;
  coverLetterGenerated: boolean;
  statusHistory: StatusEntry[];
  notes?: string;
  jobDescUrl?: string;
  applyUrl?: string;
}

export interface StatusEntry {
  status: 'applied' | 'interview' | 'offer' | 'rejected';
  date: string; // ISO date
  note?: string;
}

export interface SavedJob {
  id: string;
  company: string;
  title: string;
  category: string;
  isRemote: boolean;
  isHybrid: boolean;
  isOnsite: boolean;
  location: string; // city/state — shown on Hybrid and Office chips
  industry: string[];
  salaryDisplay: string;
  salaryNote: string;
  salaryMin: number;
  salaryMax: number;
  rating: number;
  auditLabel: string;
  roleSummary: string;
  whyYouFit: string[];
  requirements: string[];
  companyInfo: string;
  goldFlags: string[];
  redFlags: string[];
  applyUrl: string;
  careersUrl: string;
  aboutUrl: string;
  jobDescUrl: string;
  postedDate: string;
  excluded: false;
  fullJD?: string;
}

export interface ExcludedJob {
  id: string;
  company: string;
  title: string;
  layerFailed: string;
  reason: string;
  excluded: true;
}

const KEYS = {
  JOBS: 'uxjb_jobs',
  APPLIED: 'uxjb_applied',
  INSTRUCTIONS: 'uxjb_instructions',
  API_KEY: 'uxjb_api_key',
  SERPER_KEY: 'uxjb_serper_key',
  LAST_SEARCH: 'uxjb_last_search',
};



function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

// ── Jobs Board ──────────────────────────────────────────────
export function getSavedJobs(): SavedJob[] {
  return safe(() => JSON.parse(localStorage.getItem(KEYS.JOBS) || '[]'), []);
}
export function setSavedJobs(jobs: SavedJob[]) {
  localStorage.setItem(KEYS.JOBS, JSON.stringify(jobs));
}
export function clearSavedJobs() {
  localStorage.removeItem(KEYS.JOBS);
}

// ── Applied Jobs ────────────────────────────────────────────
export function getAppliedJobs(): AppliedJob[] {
  return safe(() => JSON.parse(localStorage.getItem(KEYS.APPLIED) || '[]'), []);
}
export function saveAppliedJob(job: AppliedJob) {
  const all = getAppliedJobs();
  const idx = all.findIndex(j => j.id === job.id);
  if (idx >= 0) { all[idx] = job; } else { all.unshift(job); }
  localStorage.setItem(KEYS.APPLIED, JSON.stringify(all));
}
export function markDocGenerated(jobId: string, type: 'resume' | 'coverLetter', jobData?: Partial<AppliedJob>) {
  const all = getAppliedJobs();
  const idx = all.findIndex(j => j.id === jobId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    if (type === 'resume') all[idx].resumeGenerated = true;
    if (type === 'coverLetter') all[idx].coverLetterGenerated = true;
    // Add 'applied' status if not already present
    if (!all[idx].statusHistory.find(s => s.status === 'applied')) {
      all[idx].statusHistory.push({ status: 'applied', date: now });
    }
  } else {
    const newEntry: AppliedJob = {
      id: jobId,
      company: jobData?.company || '',
      title: jobData?.title || '',
      appliedAt: now,
      resumeGenerated: type === 'resume',
      coverLetterGenerated: type === 'coverLetter',
      statusHistory: [{ status: 'applied', date: now }],
      jobDescUrl: jobData?.jobDescUrl,
      applyUrl: jobData?.applyUrl,
    };
    all.unshift(newEntry);
  }
  localStorage.setItem(KEYS.APPLIED, JSON.stringify(all));
}
export function addStatusToJob(jobId: string, status: StatusEntry['status'], note?: string) {
  const all = getAppliedJobs();
  const idx = all.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    all[idx].statusHistory.push({ status, date: new Date().toISOString(), note });
    localStorage.setItem(KEYS.APPLIED, JSON.stringify(all));
  }
}
export function deleteAppliedJob(jobId: string) {
  const all = getAppliedJobs().filter(j => j.id !== jobId);
  localStorage.setItem(KEYS.APPLIED, JSON.stringify(all));
}
export function clearAppliedJobs() {
  localStorage.removeItem(KEYS.APPLIED);
}
export function isJobApplied(jobId: string): boolean {
  return getAppliedJobs().some(j => j.id === jobId);
}

// ── Instructions ────────────────────────────────────────────
export interface SavedInstructions {
  jobSearch: string;
  resume: string;
  coverLetter: string;
}
export function getSavedInstructions(): SavedInstructions | null {
  return safe(() => JSON.parse(localStorage.getItem(KEYS.INSTRUCTIONS) || 'null'), null);
}
export function saveInstructions(instructions: SavedInstructions) {
  localStorage.setItem(KEYS.INSTRUCTIONS, JSON.stringify(instructions));
}

// ── API Keys ────────────────────────────────────────────────
export function getLocalApiKey(): string {
  return safe(() => localStorage.getItem(KEYS.API_KEY) || '', '');
}
export function setLocalApiKey(key: string) {
  if (key) localStorage.setItem(KEYS.API_KEY, key);
  else localStorage.removeItem(KEYS.API_KEY);
}
export function getLocalSerperKey(): string {
  return safe(() => localStorage.getItem(KEYS.SERPER_KEY) || '', '');
}
export function setLocalSerperKey(key: string) {
  if (key) localStorage.setItem(KEYS.SERPER_KEY, key);
  else localStorage.removeItem(KEYS.SERPER_KEY);
}

// ── Last Search ─────────────────────────────────────────────
export function getLastSearchQuery(): string {
  return safe(() => localStorage.getItem(KEYS.LAST_SEARCH) || '', '');
}
export function setLastSearchQuery(q: string) {
  localStorage.setItem(KEYS.LAST_SEARCH, q);
}
// ── Uploaded Templates ───────────────────────────────────────
const UPLOAD_KEYS = {
  RESUME: 'uxjb_uploaded_resume',
  COVER: 'uxjb_uploaded_cover',
  RESUME_META: 'uxjb_uploaded_resume_meta',
  COVER_META: 'uxjb_uploaded_cover_meta',
};

export interface UploadMeta {
  filename: string;
  uploadedAt: string;
  fileType: 'html' | 'pdf' | 'docx';
}

export function getUploadedResume(): string {
  return safe(() => localStorage.getItem(UPLOAD_KEYS.RESUME) || '', '');
}
export function getUploadedResumeMeta(): UploadMeta | null {
  return safe(() => JSON.parse(localStorage.getItem(UPLOAD_KEYS.RESUME_META) || 'null'), null);
}
export function setUploadedResume(content: string, meta: UploadMeta) {
  localStorage.setItem(UPLOAD_KEYS.RESUME, content);
  localStorage.setItem(UPLOAD_KEYS.RESUME_META, JSON.stringify(meta));
}
export function getUploadedCover(): string {
  return safe(() => localStorage.getItem(UPLOAD_KEYS.COVER) || '', '');
}
export function getUploadedCoverMeta(): UploadMeta | null {
  return safe(() => JSON.parse(localStorage.getItem(UPLOAD_KEYS.COVER_META) || 'null'), null);
}
export function setUploadedCover(content: string, meta: UploadMeta) {
  localStorage.setItem(UPLOAD_KEYS.COVER, content);
  localStorage.setItem(UPLOAD_KEYS.COVER_META, JSON.stringify(meta));
}
export function clearAllStorage() {
  // Wipe everything — no key list to maintain, nothing left behind
  localStorage.clear();
}

// ── Candidate Profile ────────────────────────────────────────
const PROFILE_KEY = 'uxjb_candidate_profile';

export function getSavedProfile(): import('./instructions').CandidateProfile | null {
  return safe(() => JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'), null);
}
export function saveProfile(profile: import('./instructions').CandidateProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
export function clearProfile() {
  localStorage.removeItem(PROFILE_KEY);
}

// ── Search History ────────────────────────────────────────────
const HISTORY_KEY = 'uxjb_search_history';
const MAX_HISTORY = 5;

export interface SearchSnapshot {
  id: string;
  title: string;           // Auto-generated from target titles
  timestamp: string;       // ISO date
  jobs: SavedJob[];
  excludedJobs: ExcludedJobSnapshot[];
  searchMeta: {
    targetTitles: string[];
    workTypes: string[];
    locations: string[];
    salaryMin: number;
    salaryMax: number;
    jobCount: number;
  };
}

export interface ExcludedJobSnapshot {
  id: string; company: string; title: string;
  layerFailed: string; reason: string; excluded: true;
  applyUrl?: string; careersUrl?: string; jobDescUrl?: string;
  category?: string; isRemote?: boolean; isHybrid?: boolean;
  industry?: string[]; salaryMin?: number; salaryMax?: number;
  salaryDisplay?: string; salaryNote?: string; rating?: number;
  roleSummary?: string; whyYouFit?: string[]; requirements?: string[];
  companyInfo?: string; goldFlags?: string[]; redFlags?: string[];
  postedDate?: string;
}

export function getSearchHistory(): SearchSnapshot[] {
  return safe(() => JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'), []);
}

export function saveSearchToHistory(snapshot: SearchSnapshot) {
  const history = getSearchHistory();
  // Prepend newest first
  const updated = [snapshot, ...history].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export function deleteSearchFromHistory(id: string) {
  const updated = getSearchHistory().filter(s => s.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export function deleteOldestSearch() {
  const history = getSearchHistory();
  if (history.length === 0) return;
  const updated = history.slice(0, history.length - 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export function getHistoryCount(): number {
  return getSearchHistory().length;
}

export function isHistoryFull(): boolean {
  return getSearchHistory().length >= MAX_HISTORY;
}

export function clearSearchHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ── Export / Import (full localStorage snapshot) ─────────────
export const EXPORT_VERSION = '1.0';
export const ALL_KEYS = [
  'uxjb_jobs', 'uxjb_applied', 'uxjb_instructions',
  'uxjb_api_key', 'uxjb_serper_key', 'uxjb_last_search',
  'uxjb_uploaded_resume', 'uxjb_uploaded_cover',
  'uxjb_uploaded_resume_meta', 'uxjb_uploaded_cover_meta',
  'uxjb_candidate_profile', 'uxjb_search_history',
];

export interface AppExport {
  _version: string;
  _exportedAt: string;
  _appId: 'ux-job-board';
  data: Record<string, string>; // raw localStorage string values
}

export function exportAppData(): AppExport {
  const data: Record<string, string> = {};
  ALL_KEYS.forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) data[key] = val;
  });
  return {
    _version: EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),
    _appId: 'ux-job-board',
    data,
  };
}

export function validateImport(raw: unknown): raw is AppExport {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return obj._appId === 'ux-job-board' && typeof obj._version === 'string' && typeof obj.data === 'object';
}

export function importAppData(exported: AppExport): void {
  // Wipe everything before applying imported data
  localStorage.clear();
  // Apply imported data
  Object.entries(exported.data).forEach(([key, value]) => {
    if (ALL_KEYS.includes(key)) localStorage.setItem(key, value);
  });
}
// ── Wizard Seen ─────────────────────────────────────────────
const WIZARD_SEEN_KEY = 'uxjb_wizard_seen';

export function getWizardSeen(): boolean {
  return safe(() => localStorage.getItem(WIZARD_SEEN_KEY) === '1', false);
}
export function setWizardSeen() {
  localStorage.setItem(WIZARD_SEEN_KEY, '1');
}

