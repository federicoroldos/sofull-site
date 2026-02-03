import type { SpicinessLevel } from '../types/ramyeon';

interface Props {
  level: SpicinessLevel;
}

const spiceMap: Record<SpicinessLevel, { label: string; value: number }> = {
  mild: { label: 'Mild', value: 1 },
  medium: { label: 'Medium', value: 2 },
  hot: { label: 'Hot', value: 3 },
  extreme: { label: 'Extreme', value: 4 }
};

const SpiceMeter = ({ level }: Props) => {
  const spice = spiceMap[level];
  return (
    <div className="spice">
      <span className={`spice__label spice__label--${level}`}>{spice.label}</span>
      <div className="spice__meter" aria-label={`Spiciness ${spice.label}`}>
        {[1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={`spice__pepper ${index <= spice.value ? 'spice__pepper--on' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};

export default SpiceMeter;
