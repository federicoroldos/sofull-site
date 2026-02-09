import type { EntryCategory, SpicinessLevel } from '../types/sofull';
import { getAttributeIcon, getAttributeLabel, getAttributeLevelLabel, getAttributeValue } from '../utils/attribute';

interface Props {
  level: SpicinessLevel;
  category: EntryCategory;
}

const AttributeMeter = ({ level, category }: Props) => {
  const attributeLabel = getAttributeLabel(category);
  const levelLabel = getAttributeLevelLabel(category, level);
  const value = getAttributeValue(level);
  const renderIcon = getAttributeIcon(category);

  return (
    <div className="spice">
      <span className={`spice__label spice__label--${level}`}>{levelLabel}</span>
      <div className="spice__meter rating rating--sm" aria-label={`${attributeLabel} ${levelLabel}`}>
        {[1, 2, 3, 4].map((index) => renderIcon(index, index <= value))}
      </div>
    </div>
  );
};

export default AttributeMeter;

