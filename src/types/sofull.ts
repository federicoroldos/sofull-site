export type FormFactor = 'packet' | 'cup';
export type IceCreamFormFactor = 'bar' | 'cream';
export type SpicinessLevel = 'not-spicy' | 'mild' | 'medium' | 'hot' | 'extreme';
export type EntryCategory = 'ramyeon' | 'snack' | 'drink' | 'ice_cream';

export interface SofullEntry {
  id: string;
  name: string;
  nameEnglish?: string;
  brand: string;
  category: EntryCategory;
  formFactor: FormFactor;
  iceCreamFormFactor: IceCreamFormFactor;
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

export interface SofullDataFile {
  version: number;
  updatedAt: string;
  entries: SofullEntry[];
}
