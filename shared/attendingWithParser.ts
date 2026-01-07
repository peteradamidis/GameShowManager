/**
 * Shared utility for parsing the attendingWith field consistently across the entire system.
 * This ensures solo detection and partner parsing work the same way everywhere.
 */

// Solo indicators - exact matches (case-insensitive, trimmed)
const SOLO_EXACT_MATCHES = [
  '-', 'na', 'n/a', 'none', 'solo', 'alone', 'self', 'no one', 'nobody', 
  'no-one', 'myself', 'me', 'just me', 'n.a.', 'n.a', 'nil', 'no', ''
];

// Solo phrases - if attendingWith contains these, treat as solo
const SOLO_PHRASES = [
  'by myself', 'on my own', 'coming alone', 'attending alone', 
  'no one else', 'just me', 'on own', 'by self'
];

// Delimiters used to split multiple partner names
const PARTNER_DELIMITERS = /[,&/\n\r]+/;

export interface ParsedAttendingWith {
  isSolo: boolean;
  partnerNames: string[];
  groupSize: number;
  raw: string;
}

/**
 * Normalize a name for matching purposes.
 * Removes extra whitespace, punctuation, and converts to lowercase.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Parse the attendingWith field and return structured information.
 * This is the single source of truth for interpreting attendingWith.
 */
export function parseAttendingWith(attendingWith: string | null | undefined): ParsedAttendingWith {
  // Handle null/undefined/empty
  if (!attendingWith || !attendingWith.trim()) {
    return {
      isSolo: true,
      partnerNames: [],
      groupSize: 1,
      raw: attendingWith || ''
    };
  }

  const raw = attendingWith;
  const trimmed = attendingWith.trim();
  const normalized = trimmed.toLowerCase();

  // Check exact matches for solo indicators
  if (SOLO_EXACT_MATCHES.includes(normalized)) {
    return {
      isSolo: true,
      partnerNames: [],
      groupSize: 1,
      raw
    };
  }

  // Check if any solo phrase is contained
  if (SOLO_PHRASES.some(phrase => normalized.includes(phrase))) {
    return {
      isSolo: true,
      partnerNames: [],
      groupSize: 1,
      raw
    };
  }

  // Split by delimiters and extract partner names
  const parts = trimmed
    .split(PARTNER_DELIMITERS)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Filter out any parts that are themselves solo indicators
  const validPartners = parts.filter(part => {
    const partNormalized = part.toLowerCase();
    return !SOLO_EXACT_MATCHES.includes(partNormalized);
  });

  if (validPartners.length === 0) {
    return {
      isSolo: true,
      partnerNames: [],
      groupSize: 1,
      raw
    };
  }

  return {
    isSolo: false,
    partnerNames: validPartners,
    groupSize: validPartners.length + 1, // +1 for the contestant themselves
    raw
  };
}

/**
 * Check if a contestant's attendingWith indicates they are solo.
 */
export function isSoloContestant(attendingWith: string | null | undefined): boolean {
  return parseAttendingWith(attendingWith).isSolo;
}

/**
 * Get the group size for a contestant based on their attendingWith field.
 */
export function getGroupSizeFromAttendingWith(attendingWith: string | null | undefined): number {
  return parseAttendingWith(attendingWith).groupSize;
}

/**
 * Get normalized partner names from attendingWith field.
 * Returns empty array for solo contestants.
 */
export function getPartnerNames(attendingWith: string | null | undefined): string[] {
  return parseAttendingWith(attendingWith).partnerNames;
}

/**
 * Get normalized partner names for matching purposes.
 * Returns lowercase, punctuation-stripped names.
 */
export function getNormalizedPartnerNames(attendingWith: string | null | undefined): string[] {
  return parseAttendingWith(attendingWith).partnerNames.map(normalizeName);
}

/**
 * Check if two contestants might be partners based on their attendingWith fields
 * and their names. For a match, contestant A should list B's name AND B should list A's name.
 */
export function areContestantsMutualPartners(
  contestantAName: string,
  contestantAAttendingWith: string | null | undefined,
  contestantBName: string,
  contestantBAttendingWith: string | null | undefined
): boolean {
  const parsedA = parseAttendingWith(contestantAAttendingWith);
  const parsedB = parseAttendingWith(contestantBAttendingWith);

  // If either is solo, they can't be partners
  if (parsedA.isSolo || parsedB.isSolo) {
    return false;
  }

  const normalizedAName = normalizeName(contestantAName);
  const normalizedBName = normalizeName(contestantBName);
  const normalizedAPartners = parsedA.partnerNames.map(normalizeName);
  const normalizedBPartners = parsedB.partnerNames.map(normalizeName);

  // Check if A lists B
  const aListsB = normalizedAPartners.some(partner => 
    normalizedBName.includes(partner) || partner.includes(normalizedBName)
  );

  // Check if B lists A
  const bListsA = normalizedBPartners.some(partner => 
    normalizedAName.includes(partner) || partner.includes(normalizedAName)
  );

  // Require mutual reference for strong matching
  return aListsB && bListsA;
}

/**
 * Check if a contestant's attendingWith mentions a specific name.
 * Uses fuzzy matching - checks if either contains the other.
 */
export function attendingWithMentionsName(
  attendingWith: string | null | undefined,
  targetName: string
): boolean {
  const parsed = parseAttendingWith(attendingWith);
  if (parsed.isSolo) {
    return false;
  }

  const normalizedTarget = normalizeName(targetName);
  return parsed.partnerNames.some(partner => {
    const normalizedPartner = normalizeName(partner);
    return normalizedPartner.includes(normalizedTarget) || 
           normalizedTarget.includes(normalizedPartner);
  });
}
