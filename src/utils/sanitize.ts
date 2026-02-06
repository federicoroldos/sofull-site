import type { EntryCategory, FormFactor, RamyeonEntry, SpicinessLevel } from '../types/ramyeon';

import type { IceCreamFormFactor } from '../types/ramyeon';

const MAX_NAME = 80;
const MAX_BRAND = 60;
const MAX_DESCRIPTION = 280;
const MAX_IMAGE_URL = 2048;
const MAX_DRIVE_FILE_ID = 256;
const MAX_IMAGE_MIME_TYPE = 100;
const MAX_IMAGE_NAME = 180;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

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

const buildLegacyId = (entry: Record<string, unknown>, createdAt: string) => {
  const fingerprint = [
    sanitizeText(entry.name, MAX_NAME),
    sanitizeText(entry.nameEnglish, MAX_NAME),
    sanitizeText(entry.brand, MAX_BRAND),
    createdAt
  ]
    .join('|')
    .toLowerCase();

  let hash = 0;
  for (let i = 0; i < fingerprint.length; i += 1) {
    hash = (hash * 31 + fingerprint.charCodeAt(i)) | 0;
  }
  return `ramyeon-legacy-${Math.abs(hash).toString(36)}`;
};

const normalizeIsoDate = (value: unknown): string => {
  if (!value) return '';

  if (typeof value === 'string') {
    const candidate = sanitizeText(value, 80);
    if (!candidate) return '';
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed)) return '';
    return new Date(parsed).toISOString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const normalized = Math.abs(value) < 1e12 ? value * 1000 : value;
    const parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString();
  }

  if (typeof value === 'object') {
    const dateLike = value as Record<string, unknown>;
    if (typeof dateLike.toDate === 'function') {
      try {
        const parsed = (dateLike.toDate as () => Date)();
        if (!Number.isFinite(parsed.getTime())) return '';
        return parsed.toISOString();
      } catch {
        return '';
      }
    }

    const seconds =
      typeof dateLike.seconds === 'number'
        ? dateLike.seconds
        : typeof dateLike._seconds === 'number'
          ? dateLike._seconds
          : null;
    if (seconds !== null) {
      const nanos =
        typeof dateLike.nanoseconds === 'number'
          ? dateLike.nanoseconds
          : typeof dateLike._nanoseconds === 'number'
            ? dateLike._nanoseconds
            : 0;
      const parsed = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
      if (!Number.isFinite(parsed.getTime())) return '';
      return parsed.toISOString();
    }

    if ('timestamp' in dateLike) {
      return normalizeIsoDate(dateLike.timestamp);
    }
  }

  return '';
};

const sanitizeRating = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(5, Math.max(1, Math.round(numeric * 2) / 2));
};

const FORM_FACTORS: FormFactor[] = ['packet', 'cup'];
const ICE_CREAM_FORM_FACTORS: IceCreamFormFactor[] = ['bar', 'cream'];
const SPICINESS: SpicinessLevel[] = ['not-spicy', 'mild', 'medium', 'hot', 'extreme'];
const CATEGORIES: EntryCategory[] = ['ramyeon', 'snack', 'drink', 'ice_cream'];

const sanitizeFormFactor = (value: unknown): FormFactor =>
  FORM_FACTORS.includes(value as FormFactor) ? (value as FormFactor) : 'packet';

const sanitizeIceCreamFormFactor = (value: unknown): IceCreamFormFactor =>
  ICE_CREAM_FORM_FACTORS.includes(value as IceCreamFormFactor) ? (value as IceCreamFormFactor) : 'bar';

const sanitizeSpiciness = (value: unknown): SpicinessLevel =>
  SPICINESS.includes(value as SpicinessLevel) ? (value as SpicinessLevel) : 'mild';

const sanitizeCategory = (value: unknown): EntryCategory =>
  CATEGORIES.includes(value as EntryCategory) ? (value as EntryCategory) : 'ramyeon';

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
  const entry = value as Partial<RamyeonEntry> & Record<string, unknown>;
  const derivedCreatedAt =
    normalizeIsoDate(entry.createdAt) ||
    normalizeIsoDate(entry.created_at) ||
    normalizeIsoDate(entry.createdTime) ||
    normalizeIsoDate(entry.timestamp) ||
    EPOCH_ISO;
  const derivedUpdatedAt =
    normalizeIsoDate(entry.updatedAt) ||
    normalizeIsoDate(entry.updated_at) ||
    normalizeIsoDate(entry.updatedTime) ||
    derivedCreatedAt;
  const derivedId = sanitizeText(entry.id, 80) || buildLegacyId(entry, derivedCreatedAt);

  return {
    id: derivedId,
    name: sanitizeText(entry.name, MAX_NAME),
    nameEnglish: sanitizeText(entry.nameEnglish, MAX_NAME),
    brand: sanitizeText(entry.brand, MAX_BRAND),
    category: sanitizeCategory(entry.category),
    formFactor: sanitizeFormFactor(entry.formFactor),
    iceCreamFormFactor: sanitizeIceCreamFormFactor(entry.iceCreamFormFactor),
    rating: sanitizeRating(entry.rating),
    spiciness: sanitizeSpiciness(entry.spiciness),
    description: sanitizeText(entry.description, MAX_DESCRIPTION),
    imageUrl: sanitizeUrl(entry.imageUrl),
    imageDriveFileId: sanitizeText(entry.imageDriveFileId, MAX_DRIVE_FILE_ID),
    imageMimeType: sanitizeText(entry.imageMimeType, MAX_IMAGE_MIME_TYPE),
    imageName: sanitizeText(entry.imageName, MAX_IMAGE_NAME),
    createdAt: derivedCreatedAt,
    updatedAt: derivedUpdatedAt
  };
};

export const sanitizeEntries = (entries: unknown) => {
  if (!Array.isArray(entries)) return [] as RamyeonEntry[];
  const sanitized = entries
    .map((entry) => sanitizeEntry(entry))
    .filter((entry): entry is RamyeonEntry => Boolean(entry));
  return sanitized;
};
