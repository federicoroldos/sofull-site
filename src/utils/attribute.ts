import { createElement } from 'react';
import type { EntryCategory, SpicinessLevel } from '../types/ramyeon';

const ATTRIBUTE_LABELS: Record<EntryCategory, string> = {
  ramyeon: 'Spiciness',
  snack: 'Crunchiness',
  drink: 'Sweetness',
  ice_cream: 'Creaminess'
};

const ATTRIBUTE_LEVEL_VALUES: Record<SpicinessLevel, number> = {
  'not-spicy': 0,
  mild: 1,
  medium: 2,
  hot: 3,
  extreme: 4
};

const ATTRIBUTE_LEVEL_LABELS: Record<EntryCategory, Record<SpicinessLevel, string>> = {
  ramyeon: {
    'not-spicy': 'Not spicy',
    mild: 'Mild',
    medium: 'Medium',
    hot: 'Hot',
    extreme: 'Extreme'
  },
  snack: {
    'not-spicy': 'Not crunchy',
    mild: 'Lighty crunchy',
    medium: 'Crunchy',
    hot: 'Very crunchy',
    extreme: 'Ultra crunchy'
  },
  drink: {
    'not-spicy': 'Not sweet',
    mild: 'Lightly sweet',
    medium: 'Sweet',
    hot: 'Very sweet',
    extreme: 'Ultra sweet'
  },
  ice_cream: {
    'not-spicy': 'Not creamy',
    mild: 'Lightly creamy',
    medium: 'Creamy',
    hot: 'Very creamy',
    extreme: 'Ultra creamy'
  }
};

const ATTRIBUTE_ICON_CLASSES: Record<EntryCategory, string> = {
  ramyeon: '',
  snack: 'spice__pepper--snack',
  drink: 'spice__pepper--drink',
  ice_cream: 'spice__pepper--ice-cream'
};

export const ATTRIBUTE_LEVELS: SpicinessLevel[] = ['not-spicy', 'mild', 'medium', 'hot', 'extreme'];

const resolveCategory = (category?: EntryCategory): EntryCategory =>
  category && Object.prototype.hasOwnProperty.call(ATTRIBUTE_LABELS, category) ? category : 'ramyeon';

export const getAttributeLabel = (category?: EntryCategory) =>
  ATTRIBUTE_LABELS[resolveCategory(category)];

export const getAttributeLevelLabel = (category: EntryCategory | undefined, level: SpicinessLevel) =>
  ATTRIBUTE_LEVEL_LABELS[resolveCategory(category)][level];

export const getAttributeValue = (level: SpicinessLevel) => ATTRIBUTE_LEVEL_VALUES[level];

export const getAttributeIcon = (category?: EntryCategory) => {
  const iconClass = ATTRIBUTE_ICON_CLASSES[resolveCategory(category)];
  return (index: number, isOn: boolean) =>
    createElement('span', {
      key: index,
      className: ['spice__pepper', iconClass, isOn ? 'spice__pepper--on' : ''].filter(Boolean).join(' ')
    });
};
