import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface ParseResponse {
  text?: string;
  error?: string;
  details?: string;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Get reliable temp directory for Vercel
 */
function getTempDir(): string {
  const candidates = [
    '/tmp',
    os.tmpdir(),
    path.join(process.cwd(), '.vercel/tmp'),
    path.join(process.cwd(), 'tmp'),
  ];

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testFile = path.join(dir, `.test-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('[parse-resume] Using temp dir:', dir);
      return dir;
    } catch (err) {
      console.log('[parse-resume] Temp dir failed:', dir, '-', err instanceof Error ? err.message : 'Unknown');
      continue;
    }
  }

  throw new Error('No writable temp directory available');
}

/**
 * Parse DOCX using mammoth
 */
async function parseDocx(filePath: string): Promise<string> {
  try {
    // Static require for build-time resolution
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');

    if (!mammoth || !mammoth.extractRawText) {
      throw new Error('mammoth module not properly loaded');
    }

    console.log('[parse-resume] Parsing DOCX file:', filePath);
    const result = await mammoth.extractRawText({ path: filePath });
    console.log('[parse-resume] DOCX parsed, text length:', result?.value?.length || 0);
    
    if (!result || !result.value) {
      throw new Error('No text extracted from DOCX');
    }

    let text = result.value.trim();

    // Extract embedded hyperlinks via HTML conversion
    try {
      const htmlResult = await mammoth.convertToHtml({ path: filePath });
      const hrefs = [...(htmlResult.value || '').matchAll(/href="(https?:\/\/[^"]+)"/g)]
        .map((m: RegExpMatchArray) => m[1])
        .filter((url: string, i: number, arr: string[]) => arr.indexOf(url) === i);
      if (hrefs.length > 0) {
        console.log('[parse-resume] Found', hrefs.length, 'embedded links in DOCX');
        text += '\n\nEMBEDDED LINKS:\n' + hrefs.join('\n');
      }
    } catch { /* ignore link extraction errors */ }

    return text;
  } catch (err) {
    console.error('[parse-resume] DOCX parsing error:', err);
    throw new Error(`DOCX: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

/**
 * Extract hyperlink annotations from a PDF (embedded link URLs not in text layer).
 */
async function extractPdfLinks(pdfjsLib: any, data: Uint8Array): Promise<string[]> {
  try {
    const pdf = await pdfjsLib.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const urls: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const annotations = await page.getAnnotations();
      for (const ann of annotations) {
        const url = ann.url || ann.unsafeUrl;
        if (url && typeof url === 'string' && url.startsWith('http') && !urls.includes(url)) {
          urls.push(url);
        }
      }
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Parse PDF using pdfjs-dist legacy (works in Node.js without DOM APIs)
 */
async function parsePdf(filePath: string): Promise<string> {
  try {
    // Load worker first so pdfjs uses _mainThreadWorkerMessageHandler
    // instead of spawning a worker thread (which fails in serverless/Vercel)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('pdfjs-dist/legacy/build/pdf.worker.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

    console.log('[parse-resume] Reading PDF file:', filePath);
    const fileBuffer = fs.readFileSync(filePath);
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('PDF file is empty');
    }

    console.log('[parse-resume] Parsing PDF buffer, size:', fileBuffer.length);
    const data = new Uint8Array(fileBuffer);
    const pdf = await pdfjsLib.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    console.log('[parse-resume] PDF loaded, pages:', pdf.numPages);

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');
      text += pageText + '\n';
    }

    text = text.replace(/\s{3,}/g, '  ').trim();
    console.log('[parse-resume] PDF parsed, text length:', text.length);

    if (!text) {
      throw new Error('No text in PDF - may be image-based or encrypted');
    }

    // Extract embedded hyperlink annotations (not in text layer)
    const links = await extractPdfLinks(pdfjsLib, data);
    if (links.length > 0) {
      console.log('[parse-resume] Found', links.length, 'embedded links in PDF');
      text += '\n\nEMBEDDED LINKS:\n' + links.join('\n');
    }

    return text;
  } catch (err) {
    console.error('[parse-resume] PDF parsing error:', err);
    throw new Error(`PDF: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

/**
 * Parse HTML
 */
async function parseHtml(filePath: string): Promise<string> {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }

    console.log('[parse-resume] Reading HTML file:', filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content) {
      throw new Error('File is empty');
    }

    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('[parse-resume] HTML parsed, text length:', text.length);
    
    if (!text) {
      throw new Error('No text content found');
    }

    return text;
  } catch (err) {
    console.error('[parse-resume] HTML parsing error:', err);
    throw new Error(`HTML: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ParseResponse>
) {
  console.log('[parse-resume] Request received, method:', req.method);
  
  if (req.method !== 'POST') {
    console.error('[parse-resume] Wrong method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let uploadDir = '';
  let filePath = '';

  try {
    // Get temp directory
    try {
      uploadDir = getTempDir();
    } catch (err) {
      return res.status(500).json({
        error: 'Server temp directory error',
        details: err instanceof Error ? err.message : 'No writable directory',
      });
    }

    // Parse form
    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024,
    });

    let fields: any = {}, files: any = {};
    try {
      [fields, files] = await form.parse(req);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Form parse error';
      console.error('[parse-resume] Form parse error:', errMsg);
      return res.status(400).json({
        error: 'File upload failed',
        details: errMsg,
      });
    }

    // Handle formidable v3 output - files is a Map-like object
    console.log('[parse-resume] Files keys:', Object.keys(files || {}));
    
    let file;
    if (!files || !files.file) {
      console.error('[parse-resume] No files.file in parse result');
      return res.status(400).json({ error: 'No file provided' });
    }

    // files.file could be array or single
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    file = fileArray?.[0];

    if (!file) {
      console.error('[parse-resume] File array empty');
      return res.status(400).json({ error: 'No file provided' });
    }
    
    console.log('[parse-resume] File object keys:', Object.keys(file || {}));

    filePath = (file as any).filepath || (file as any).path || (file as any).pathName || '';
    const fileName = (file as any).originalFilename || (file as any).name || (file as any).filename || '';

    console.log('[parse-resume] File properties:', {
      filepath: (file as any).filepath,
      path: (file as any).path,
      pathName: (file as any).pathName,
      originalFilename: (file as any).originalFilename,
      name: (file as any).name,
      filename: (file as any).filename,
      extracted_filePath: filePath,
      extracted_fileName: fileName,
    });

    if (!filePath) {
      console.error('[parse-resume] Could not extract file path from file object');
      return res.status(400).json({ error: 'File path missing', details: JSON.stringify(Object.keys(file)) });
    }

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      console.error('[parse-resume] File path does not exist:', filePath);
      console.error('[parse-resume] Listing uploadDir contents:', fs.readdirSync(uploadDir).slice(0, 10));
      return res.status(400).json({ error: 'File not found on disk', details: filePath });
    }

    const fileStats = fs.statSync(filePath);
    console.log('[parse-resume] File size:', fileStats.size, 'bytes');
    
    const ext = path.extname(fileName).toLowerCase().slice(1);
    if (!ext) {
      console.error('[parse-resume] File has no extension:', fileName);
      return res.status(400).json({ error: 'File has no extension', details: `Got: ${fileName}` });
    }
    
    console.log('[parse-resume] File extension:', ext);

    let text = '';

    // Parse by type
    try {
      console.log('[parse-resume] Starting parse for type:', ext);
      if (ext === 'html' || ext === 'htm') {
        text = await parseHtml(filePath);
      } else if (ext === 'docx') {
        text = await parseDocx(filePath);
      } else if (ext === 'pdf') {
        text = await parsePdf(filePath);
      } else {
        console.error('[parse-resume] Unsupported extension:', ext);
        return res.status(400).json({
          error: `Unsupported: .${ext}`,
          details: 'Use .html, .docx, or .pdf',
        });
      }
      console.log('[parse-resume] Parse successful, text length:', text.length);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Unknown error';
      console.error('[parse-resume] Parse catch block:', msg);
      return res.status(400).json({ error: 'Parse failed', details: msg });
    }

    // Validate text
    if (!text || text.length === 0) {
      console.error('[parse-resume] No text after parsing');
      return res.status(400).json({
        error: 'No text extracted',
        details: 'File may be empty, image-based, or corrupted',
      });
    }

    console.log('[parse-resume] Success! Returning', text.length, 'characters');
    return res.status(200).json({ text: text.substring(0, 50000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[parse-resume] Error:', msg, 'uploadDir:', uploadDir);
    return res.status(500).json({ error: 'Server error', details: msg });
  } finally {
    // Cleanup
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
