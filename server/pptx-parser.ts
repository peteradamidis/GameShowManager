import JSZip from 'jszip';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const parseXml = promisify(parseString);

export interface ExtractedCard {
  slideNumber: number;
  name: string;
  ageState: string;
  occupation: string;
  sponsorCategory: string;
  tagline: string;
  bodyText: string;
  producerName: string;
  photos: {
    main?: Buffer;
    mainFilename?: string;
    companions: Array<{ data: Buffer; filename: string }>;
  };
}

export interface ParseResult {
  success: boolean;
  cards: ExtractedCard[];
  errors: string[];
}

function extractTextFromShape(shape: any): string {
  try {
    const txBody = shape['p:txBody']?.[0];
    if (!txBody) return '';
    
    const paragraphs = txBody['a:p'] || [];
    const textParts: string[] = [];
    
    for (const p of paragraphs) {
      const runs = p['a:r'] || [];
      for (const run of runs) {
        const text = run['a:t']?.[0];
        if (text) {
          if (typeof text === 'string') {
            textParts.push(text);
          } else if (text._) {
            textParts.push(text._);
          }
        }
      }
      textParts.push('\n');
    }
    
    return textParts.join('').trim();
  } catch (e) {
    return '';
  }
}

function getShapePosition(shape: any): { x: number; y: number; width: number; height: number } {
  try {
    const spPr = shape['p:spPr']?.[0];
    const xfrm = spPr?.['a:xfrm']?.[0];
    const off = xfrm?.['a:off']?.[0]?.$;
    const ext = xfrm?.['a:ext']?.[0]?.$;
    
    return {
      x: parseInt(off?.x || '0') / 914400,
      y: parseInt(off?.y || '0') / 914400,
      width: parseInt(ext?.cx || '0') / 914400,
      height: parseInt(ext?.cy || '0') / 914400
    };
  } catch (e) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function categorizeTextByPosition(texts: Array<{ text: string; pos: { x: number; y: number; width: number; height: number } }>): ExtractedCard {
  const card: ExtractedCard = {
    slideNumber: 0,
    name: '',
    ageState: '',
    occupation: '',
    sponsorCategory: '',
    tagline: '',
    bodyText: '',
    producerName: '',
    photos: { companions: [] }
  };
  
  const sortedByY = [...texts].sort((a, b) => a.pos.y - b.pos.y);
  
  for (const item of sortedByY) {
    const text = item.text.trim();
    if (!text) continue;
    
    const y = item.pos.y;
    const x = item.pos.x;
    
    if (text.toUpperCase().startsWith('PRODUCER:') || text.toUpperCase() === 'PRODUCER:') {
      continue;
    }
    
    if (y < 1.5 && item.pos.height > 0.5) {
      if (!card.name || text.length > card.name.length) {
        card.name = text.toUpperCase();
      }
    }
    else if (y >= 1.2 && y < 2.0 && !text.includes('\n') && text.length < 50) {
      const ageMatch = text.match(/^\d+\s*\([^)]+\)/);
      if (ageMatch || text.match(/^\d+/)) {
        card.ageState = text;
      } else if (text.toUpperCase().startsWith('SPONSOR') || text.includes(':')) {
        card.sponsorCategory = text;
      } else if (!card.occupation) {
        card.occupation = text;
      }
    }
    else if (y >= 2.0 && y < 3.0 && text.length < 100 && !text.includes('\n')) {
      if (text.toUpperCase().startsWith('SPONSOR') || text.includes('CATEGORY')) {
        card.sponsorCategory = text;
      } else if (!card.tagline && text.length < 80) {
        card.tagline = text;
      }
    }
    else if (text.length > 50 || text.includes('\n')) {
      if (card.bodyText) {
        card.bodyText += '\n' + text;
      } else {
        card.bodyText = text;
      }
    }
    
    if (x > 6 && y > 6) {
      const producerMatch = text.match(/^(Peter|Kathleen|Maggie|Lochie|Felicity)/i);
      if (producerMatch) {
        card.producerName = text;
      }
    }
  }
  
  return card;
}

async function extractImagesFromSlide(
  zip: JSZip, 
  slideNum: number, 
  slideRels: any
): Promise<{ main?: Buffer; mainFilename?: string; companions: Array<{ data: Buffer; filename: string }> }> {
  const result: { main?: Buffer; mainFilename?: string; companions: Array<{ data: Buffer; filename: string }> } = {
    companions: []
  };
  
  try {
    const relationships = slideRels?.Relationships?.Relationship || [];
    const imageRels = relationships.filter((rel: any) => 
      rel.$?.Type?.includes('image') || rel.$?.Target?.match(/\.(png|jpg|jpeg|gif|bmp|webp)$/i)
    );
    
    for (let i = 0; i < imageRels.length; i++) {
      const rel = imageRels[i];
      let targetPath = rel.$?.Target || '';
      
      if (targetPath.startsWith('../')) {
        targetPath = 'ppt/' + targetPath.substring(3);
      } else if (!targetPath.startsWith('ppt/')) {
        targetPath = 'ppt/media/' + path.basename(targetPath);
      }
      
      const imageFile = zip.file(targetPath);
      if (imageFile) {
        const imageData = await imageFile.async('nodebuffer');
        const filename = path.basename(targetPath);
        
        if (i === 0) {
          result.main = imageData;
          result.mainFilename = filename;
        } else {
          result.companions.push({ data: imageData, filename });
        }
      }
    }
  } catch (e) {
    console.error('Error extracting images:', e);
  }
  
  return result;
}

export async function parsePptxFile(fileBuffer: Buffer): Promise<ParseResult> {
  const result: ParseResult = {
    success: false,
    cards: [],
    errors: []
  };
  
  try {
    const zip = await JSZip.loadAsync(fileBuffer);
    
    let slideNum = 1;
    while (true) {
      const slideFile = zip.file(`ppt/slides/slide${slideNum}.xml`);
      if (!slideFile) break;
      
      try {
        const slideXml = await slideFile.async('string');
        const slideData: any = await parseXml(slideXml);
        
        const slideRelsFile = zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`);
        let slideRels: any = null;
        if (slideRelsFile) {
          const relsXml = await slideRelsFile.async('string');
          slideRels = await parseXml(relsXml);
        }
        
        const shapes = slideData?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0]?.['p:sp'] || [];
        
        const textsWithPositions: Array<{ text: string; pos: { x: number; y: number; width: number; height: number } }> = [];
        
        for (const shape of shapes) {
          const text = extractTextFromShape(shape);
          const pos = getShapePosition(shape);
          if (text) {
            textsWithPositions.push({ text, pos });
          }
        }
        
        // Debug: log all extracted text with positions
        console.log(`\n=== Slide ${slideNum} text extraction ===`);
        for (const item of textsWithPositions) {
          console.log(`  Y=${item.pos.y.toFixed(2)} H=${item.pos.height.toFixed(2)} X=${item.pos.x.toFixed(2)}: "${item.text.substring(0, 60)}${item.text.length > 60 ? '...' : ''}"`);
        }
        
        const card = categorizeTextByPosition(textsWithPositions);
        card.slideNumber = slideNum;
        
        console.log(`  -> Extracted name: "${card.name}"`);
        console.log(`  -> Age/State: "${card.ageState}"`);
        console.log(`  -> Occupation: "${card.occupation}"\n`);
        
        card.photos = await extractImagesFromSlide(zip, slideNum, slideRels);
        
        if (card.name || card.bodyText) {
          result.cards.push(card);
        }
        
      } catch (slideError: any) {
        result.errors.push(`Error parsing slide ${slideNum}: ${slideError.message}`);
      }
      
      slideNum++;
    }
    
    result.success = result.cards.length > 0;
    
  } catch (error: any) {
    result.errors.push(`Error parsing PPTX file: ${error.message}`);
  }
  
  return result;
}

export function matchContestantByName(
  extractedName: string, 
  contestants: Array<{ id: number; name: string }>
): { match: typeof contestants[0] | null; confidence: number; candidates: typeof contestants } {
  const normalizedExtracted = extractedName.toLowerCase().trim().replace(/\s+/g, ' ');
  
  let bestMatch: typeof contestants[0] | null = null;
  let bestScore = 0;
  const candidates: typeof contestants = [];
  
  for (const contestant of contestants) {
    const fullName = contestant.name || '';
    const normalizedFull = fullName.toLowerCase().trim().replace(/\s+/g, ' ');
    
    if (normalizedExtracted === normalizedFull) {
      return { match: contestant, confidence: 100, candidates: [contestant] };
    }
    
    let score = 0;
    
    const extractedParts = normalizedExtracted.split(' ');
    const contestantParts = normalizedFull.split(' ');
    
    for (const part of extractedParts) {
      if (contestantParts.includes(part)) {
        score += 30;
      }
    }
    
    if (extractedParts[0] === contestantParts[0]) {
      score += 20;
    }
    if (extractedParts[extractedParts.length - 1] === contestantParts[contestantParts.length - 1]) {
      score += 25;
    }
    
    if (normalizedFull.includes(normalizedExtracted) || normalizedExtracted.includes(normalizedFull)) {
      score += 15;
    }
    
    if (score > 0) {
      candidates.push(contestant);
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = contestant;
    }
  }
  
  const confidence = Math.min(bestScore, 95);
  
  return {
    match: confidence >= 50 ? bestMatch : null,
    confidence,
    candidates: candidates.slice(0, 10)
  };
}
