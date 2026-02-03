export type FormFactor = 'packet' | 'cup';
export type SpicinessLevel = 'mild' | 'medium' | 'hot' | 'extreme';

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
  createdAt: string;
  updatedAt: string;
}

export interface RamyeonDataFile {
  version: number;
  updatedAt: string;
  entries: RamyeonEntry[];
}
