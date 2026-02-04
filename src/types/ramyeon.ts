export type FormFactor = 'packet' | 'cup';
export type SpicinessLevel = 'not-spicy' | 'mild' | 'medium' | 'hot' | 'extreme';

export interface RamyeonEntry {
  id: string;
  name: string;
  nameEnglish?: string;
  brand: string;
  formFactor: FormFactor;
  rating: number;
  spiciness: SpicinessLevel;
  description?: string;
  imageUrl?: string;
  imageDriveFileId?: string;
  imageMimeType?: string;
  imageName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RamyeonDataFile {
  version: number;
  updatedAt: string;
  entries: RamyeonEntry[];
}
