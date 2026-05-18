import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, File as FormidableFile } from 'formidable';
import fs from 'fs';
import path from 'path';

interface ParseResponse {
  text?: string;
  error?: string;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Parse DOCX using mammoth
 */
async function parseDocx(filePath: string): Promise<string> {
  try {
    // Dynamically require mammoth (server-side only)
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value || '';
    
    if (!text.trim()) {
      throw new Error('No text extracted from DOCX file');
    }
    
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`DOCX parsing failed: ${msg}`);
  }
}

/**
 * Parse PDF using pdfjs-dist
 */
async function parsePdf(filePath: string): Promise<string> {
  try {
    // Read file as buffer
    const fileBuffer = fs.readFileSync(filePath);
    
    // Dynamically require pdfjs (server-side only)
    const pdfModule = await import('pdfjs-dist');
    
    // Get the getDocument function from the module
    const getDocument = (pdfModule as any).getDocument;
    
    if (!getDocument || typeof getDocument !== 'function') {
      throw new Error('pdfjs-dist getDocument not available');
    }
    
    // Parse the PDF
    const pdf = await getDocument({ data: fileBuffer }).promise;
    let text = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        
        // Extract text from content items
        const pageText = (content.items as Array<{ str?: string }>)
          .map(item => item.str || '')
          .join(' ');
        
        text += pageText + '\n';
      } catch (pageErr) {
        // Skip pages that fail to parse
        console.warn(`Failed to parse PDF page ${i}: ${pageErr}`);
        continue;
      }
    }
    
    if (!text.trim()) {
      throw new Error('No text extracted from PDF — may be image-based or corrupted');
    }
    
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`PDF parsing failed: ${msg}`);
  }
}

/**
 * Parse HTML by stripping tags
 */
async function parseHtml(filePath: string): Promise<string> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Strip HTML tags and normalize whitespace
    const text = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (!text) {
      throw new Error('No text content found in HTML file');
    }
    
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`HTML parsing failed: ${msg}`);
  }
}

/**
 * Main API handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ParseResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uploadDir = path.join(process.cwd(), 'tmp');
  
  // Ensure tmp directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const form = new IncomingForm({
    uploadDir,
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB
  });

  let filePath = '';

  try {
    // Parse the incoming form
    const [fields, files] = await form.parse(req);
    
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray?.[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = (file as any).filepath || (file as any).path;
    const fileName = (file as any).originalFilename || (file as any).name || '';
    
    if (!filePath) {
      return res.status(400).json({ error: 'File upload failed' });
    }

    // Determine file type
    const ext = path.extname(fileName).toLowerCase().slice(1);

    let text = '';

    try {
      if (ext === 'html' || ext === 'htm') {
        text = await parseHtml(filePath);
      } else if (ext === 'docx') {
        text = await parseDocx(filePath);
      } else if (ext === 'pdf') {
        text = await parsePdf(filePath);
      } else {
        return res.status(400).json({
          error: `Unsupported file type: .${ext}. Use HTML, DOCX, or PDF.`,
        });
      }

      // Return success with parsed text (limit to 50KB to keep response size reasonable)
      return res.status(200).json({ 
        text: text.substring(0, 50000) 
      });

    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Unknown parsing error';
      return res.status(400).json({
        error: `Parse error: ${msg}`,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({
      error: `Server error: ${msg}`,
    });
  } finally {
    // Clean up temp file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.error('Failed to clean up temp file:', cleanupErr);
      }
    }
  }
}

