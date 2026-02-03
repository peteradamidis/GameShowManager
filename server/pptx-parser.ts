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

function getGroupPosition(group: any): { x: number; y: number; width: number; height: number } {
  try {
    const grpSpPr = group['p:grpSpPr']?.[0];
    const xfrm = grpSpPr?.['a:xfrm']?.[0];
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
  
  // First pass: Find the name in the orange header (top-right area, typically Y < 0.5)
  // The name is usually the topmost text on the right side that doesn't start with a number
  for (const item of sortedByY) {
    const text = item.text.trim();
    if (!text) continue;
    
    const y = item.pos.y;
    const x = item.pos.x;
    
    // Name is in the orange header: very top of slide (Y < 0.5), right side (X > 3.5)
    // and doesn't start with a number (which would be age/state)
    if (y < 0.5 && x > 3.5 && !text.match(/^\d/) && !text.toUpperCase().startsWith('PRODUCER')) {
      // This is likely the name in the header
      card.name = text.toUpperCase();
      break;
    }
  }
  
  // Second pass: categorize remaining content
  for (const item of sortedByY) {
    const text = item.text.trim();
    if (!text) continue;
    
    const y = item.pos.y;
    const x = item.pos.x;
    
    if (text.toUpperCase().startsWith('PRODUCER:') || text.toUpperCase() === 'PRODUCER:') {
      continue;
    }
    
    // Skip the name we already found
    if (text.toUpperCase() === card.name) {
      continue;
    }
    
    // Age/State/Occupation line - starts with number, positioned below header
    // Formats: "74 - VICRETIRED PLUMBER", "28 VICREAL ESTATE AGENT", "57 VIC - SIMPSONBRICKLAYER"
    if (y >= 0.5 && y < 1.5 && text.match(/^\d+\s*(VIC|-|–)/i)) {
      // Try to split age/state from occupation
      // Pattern: age + optional dash + VIC + optional location + occupation
      // Examples: "28 VICREAL ESTATE AGENT", "74 - VICRETIRED PLUMBER", "30 VIC - SIMPSONSWIM TEACHER"
      const ageStateOccMatch = text.match(/^(\d+)\s*[-–]?\s*(VIC)(?:\s*[-–]\s*[A-Z]+)?([A-Z][A-Z\s&@.'–-]+)?/i);
      if (ageStateOccMatch && ageStateOccMatch[3]) {
        const age = ageStateOccMatch[1];
        const state = ageStateOccMatch[2].toUpperCase();
        let occupation = ageStateOccMatch[3].trim();
        // Clean up occupation - remove trailing notes like "DIVERSITY - LEBANESE" etc
        occupation = occupation.replace(/DIVERSITY\s*[-–].*$/i, '').trim();
        occupation = occupation.replace(/PRONOUNCED.*$/i, '').trim();
        occupation = occupation.replace(/NEED TO AUDITION.*$/i, '').trim();
        card.ageState = `${age} - ${state}`;
        card.occupation = occupation;
        console.log(`  -> Split age/state/occupation: "${card.ageState}" | "${card.occupation}"`);
      } else {
        // Fallback - store entire line as ageState
        card.ageState = text;
        console.log(`  -> Could not split, storing as ageState: "${text}"`);
      }
    }
    // Tagline - short text below age/state line
    else if (y >= 1.5 && y < 2.5 && !text.includes('\n') && text.length < 80) {
      if (!card.tagline && !text.match(/^Energy/i)) {
        card.tagline = text;
      }
    }
    // Body text - longer content
    else if ((text.length > 50 || text.includes('\n')) && y > 1.0) {
      if (card.bodyText) {
        card.bodyText += '\n' + text;
      } else {
        card.bodyText = text;
      }
    }
    
    // Producer name - bottom right
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
        
        const spTree = slideData?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0];
        const shapes = spTree?.['p:sp'] || [];
        const groupedShapes = spTree?.['p:grpSp'] || [];
        
        const textsWithPositions: Array<{ text: string; pos: { x: number; y: number; width: number; height: number } }> = [];
        
        // Extract from regular shapes
        for (const shape of shapes) {
          const text = extractTextFromShape(shape);
          const pos = getShapePosition(shape);
          if (text) {
            textsWithPositions.push({ text, pos });
          }
        }
        
        // Extract from grouped shapes (like the orange header banner)
        for (const group of groupedShapes) {
          const groupPos = getGroupPosition(group);
          const nestedShapes = group['p:sp'] || [];
          for (const shape of nestedShapes) {
            const text = extractTextFromShape(shape);
            const shapePos = getShapePosition(shape);
            // Use group position as base if shape position is relative
            const finalPos = {
              x: groupPos.x + (shapePos.x || 0),
              y: groupPos.y + (shapePos.y || 0),
              width: shapePos.width || groupPos.width,
              height: shapePos.height || groupPos.height
            };
            if (text) {
              textsWithPositions.push({ text, pos: finalPos });
            }
          }
          
          // Also check for nested groups
          const nestedGroups = group['p:grpSp'] || [];
          for (const nestedGroup of nestedGroups) {
            const nestedShapes2 = nestedGroup['p:sp'] || [];
            for (const shape of nestedShapes2) {
              const text = extractTextFromShape(shape);
              const pos = getShapePosition(shape);
              if (text) {
                textsWithPositions.push({ text, pos: { ...groupPos, ...pos } });
              }
            }
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
