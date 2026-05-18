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
      return dir;
    } catch {
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

    const result = await mammoth.extractRawText({ path: filePath });
    if (!result || !result.value) {
      throw new Error('No text extracted from DOCX');
    }

    return result.value.trim();
  } catch (err) {
    throw new Error(`DOCX: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

/**
 * Parse PDF using pdf-parse
 */
async function parsePdf(filePath: string): Promise<string> {
  try {
    // Static require for build-time resolution
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFParse = require('pdf-parse');

    if (!PDFParse) {
      throw new Error('pdf-parse module not available');
    }

    const fileBuffer = fs.readFileSync(filePath);
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('PDF file is empty');
    }

    const data = await PDFParse(fileBuffer);
    if (!data || !data.text) {
      throw new Error('No text in PDF - may be image-based or encrypted');
    }

    return data.text.trim();
  } catch (err) {
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

    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content) {
      throw new Error('File is empty');
    }

    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) {
      throw new Error('No text content found');
    }

    return text;
  } catch (err) {
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
  if (req.method !== 'POST') {
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

    let fields, files;
    try {
      [fields, files] = await form.parse(req);
    } catch (err) {
      return res.status(400).json({
        error: 'File upload failed',
        details: err instanceof Error ? err.message : 'Form parse error',
      });
    }

    // Get file
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray?.[0];

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    filePath = (file as any).filepath || (file as any).path;
    const fileName = (file as any).originalFilename || (file as any).name || '';

    if (!filePath) {
      return res.status(400).json({ error: 'File path missing' });
    }

    // Get extension
    const ext = path.extname(fileName).toLowerCase().slice(1);
    if (!ext) {
      return res.status(400).json({ error: 'File has no extension' });
    }

    let text = '';

    // Parse by type
    try {
      if (ext === 'html' || ext === 'htm') {
        text = await parseHtml(filePath);
      } else if (ext === 'docx') {
        text = await parseDocx(filePath);
      } else if (ext === 'pdf') {
        text = await parsePdf(filePath);
      } else {
        return res.status(400).json({
          error: `Unsupported: .${ext}`,
          details: 'Use .html, .docx, or .pdf',
        });
      }
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Unknown error';
      return res.status(400).json({ error: 'Parse failed', details: msg });
    }

    // Validate text
    if (!text || text.length === 0) {
      return res.status(400).json({
        error: 'No text extracted',
        details: 'File may be empty, image-based, or corrupted',
      });
    }

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
