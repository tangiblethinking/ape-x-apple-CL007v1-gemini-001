import type { NextApiRequest, NextApiResponse } from 'next';
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
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function getTempDir(): string {
  const candidates = ['/tmp', os.tmpdir(), path.join(process.cwd(), '.vercel/tmp'), path.join(process.cwd(), 'tmp')];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, `.test-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return dir;
    } catch {
      continue;
    }
  }
  throw new Error('No writable temp directory');
}

async function parseDocx(filePath: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');
    if (!mammoth || !mammoth.extractRawText) throw new Error('mammoth module not loaded');
    // Extract raw text
    const result = await mammoth.extractRawText({ path: filePath });
    if (!result || !result.value) throw new Error('No text extracted from DOCX');
    let text = result.value.trim();
    // Also extract hyperlinks via HTML conversion
    try {
      const htmlResult = await mammoth.convertToHtml({ path: filePath });
      const hrefs = [...(htmlResult.value || '').matchAll(/href="(https?:\/\/[^"]+)"/g)]
        .map((m: RegExpMatchArray) => m[1])
        .filter((url: string, i: number, arr: string[]) => arr.indexOf(url) === i);
      if (hrefs.length > 0) {
        text += '\n\nEMBEDDED LINKS:\n' + hrefs.join('\n');
      }
    } catch { /* ignore link extraction errors */ }
    return text;
  } catch (err) {
    throw new Error(`DOCX: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

async function parsePdf(filePath: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('pdfjs-dist/legacy/build/pdf.worker.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const fileBuffer = fs.readFileSync(filePath);
    if (!fileBuffer || fileBuffer.length === 0) throw new Error('PDF file is empty');
    const data = new Uint8Array(fileBuffer);
    const pdf = await pdfjsLib.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    let text = '';
    const embeddedLinks: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ') + '\n';
      // Extract hyperlink annotations not present in text layer
      try {
        const annotations = await page.getAnnotations();
        for (const ann of annotations) {
          const url = ann.url || ann.unsafeUrl;
          if (url && typeof url === 'string' && url.startsWith('http') && !embeddedLinks.includes(url)) {
            embeddedLinks.push(url);
          }
        }
      } catch { /* ignore annotation errors */ }
    }
    text = text.replace(/\s{3,}/g, '  ').trim();
    if (!text) throw new Error('No text in PDF - may be image-based or encrypted');
    if (embeddedLinks.length > 0) {
      text += '\n\nEMBEDDED LINKS:\n' + embeddedLinks.join('\n');
    }
    return text;
  } catch (err) {
    throw new Error(`PDF: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

async function parseHtml(filePath: string): Promise<string> {
  try {
    if (!fs.existsSync(filePath)) throw new Error('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content) throw new Error('File is empty');
    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('No text content found');
    return text;
  } catch (err) {
    throw new Error(`HTML: ${err instanceof Error ? err.message : 'Parse error'}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ParseResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let filePath = '';
  try {
    const uploadDir = getTempDir();
    const { filename, data } = req.body;

    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }

    // Write base64 to temp file
    filePath = path.join(uploadDir, `base64-${Date.now()}-${filename}`);
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const ext = path.extname(filename).toLowerCase().slice(1);
    if (!ext) {
      return res.status(400).json({ error: 'File has no extension' });
    }

    let text = '';
    if (ext === 'html' || ext === 'htm') {
      text = await parseHtml(filePath);
    } else if (ext === 'docx') {
      text = await parseDocx(filePath);
    } else if (ext === 'pdf') {
      text = await parsePdf(filePath);
    } else {
      return res.status(400).json({ error: `Unsupported: .${ext}` });
    }

    if (!text || text.length === 0) {
      return res.status(400).json({ error: 'No text extracted' });
    }

    return res.status(200).json({ text: text.substring(0, 50000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: 'Parse failed', details: msg });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  }
}
