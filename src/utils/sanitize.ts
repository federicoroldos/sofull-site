import type { FormFactor, RamyeonEntry, SpicinessLevel } from '../types/ramyeon';

const MAX_NAME = 80;
const MAX_BRAND = 60;
const MAX_DESCRIPTION = 280;
const MAX_IMAGE_URL = 2048;
const MAX_DRIVE_FILE_ID = 256;
const MAX_IMAGE_MIME_TYPE = 100;
const MAX_IMAGE_NAME = 180;

const stripControlChars = (value: string) =>
  value
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return !((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127);
    })
    .join('');

const sanitizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return '';
  const cleaned = stripControlChars(value).trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
};

const sanitizeRating = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(5, Math.max(1, Math.round(numeric * 2) / 2));
};

const FORM_FACTORS: FormFactor[] = ['packet', 'cup'];
const SPICINESS: SpicinessLevel[] = ['not-spicy', 'mild', 'medium', 'hot', 'extreme'];

const sanitizeFormFactor = (value: unknown): FormFactor =>
  FORM_FACTORS.includes(value as FormFactor) ? (value as FormFactor) : 'packet';

const sanitizeSpiciness = (value: unknown): SpicinessLevel =>
  SPICINESS.includes(value as SpicinessLevel) ? (value as SpicinessLevel) : 'mild';

export const sanitizeUrl = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return '';
    return url.toString().slice(0, MAX_IMAGE_URL);
  } catch {
    return '';
  }
};

export const sanitizeEntry = (value: unknown): RamyeonEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<RamyeonEntry>;
  return {
    id: sanitizeText(entry.id, 80) || `ramyeon-${Date.now()}`,
    name: sanitizeText(entry.name, MAX_NAME),
    nameEnglish: sanitizeText(entry.nameEnglish, MAX_NAME),
    brand: sanitizeText(entry.brand, MAX_BRAND),
    formFactor: sanitizeFormFactor(entry.formFactor),
    rating: sanitizeRating(entry.rating),
    spiciness: sanitizeSpiciness(entry.spiciness),
    description: sanitizeText(entry.description, MAX_DESCRIPTION),
    imageUrl: sanitizeUrl(entry.imageUrl),
    imageDriveFileId: sanitizeText(entry.imageDriveFileId, MAX_DRIVE_FILE_ID),
    imageMimeType: sanitizeText(entry.imageMimeType, MAX_IMAGE_MIME_TYPE),
    imageName: sanitizeText(entry.imageName, MAX_IMAGE_NAME),
    createdAt: sanitizeText(entry.createdAt, 40) || new Date().toISOString(),
    updatedAt: sanitizeText(entry.updatedAt, 40) || new Date().toISOString()
  };
};

export const sanitizeEntries = (entries: unknown) => {
  if (!Array.isArray(entries)) return [] as RamyeonEntry[];
  const sanitized = entries
    .map((entry) => sanitizeEntry(entry))
    .filter((entry): entry is RamyeonEntry => Boolean(entry));
  return sanitized;
};
