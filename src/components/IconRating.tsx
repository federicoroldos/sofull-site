import { useState, type ReactNode } from 'react';

interface Props {
  value: number;
  max: number;
  onChange?: (value: number) => void;
  renderIcon: (index: number, isOn: boolean) => ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  readonly?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  getItemLabel?: (index: number) => string;
  disabled?: boolean;
  allowZero?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const IconRating = ({
  value,
  max,
  onChange,
  renderIcon,
  ariaLabel,
  ariaLabelledBy,
  readonly,
  size = 'md',
  className,
  getItemLabel,
  disabled,
  allowZero = false
}: Props) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value;
  const isInteractive = Boolean(onChange) && !readonly && !disabled;
  const safeMax = Math.max(1, Math.floor(max));
  const minValue = allowZero ? 0 : 1;

  const handleSelect = (index: number) => {
    if (!isInteractive || !onChange) return;
    onChange(clamp(index, minValue, safeMax));
  };

  const renderButton = (index: number, isOn: boolean, label?: string, ariaChecked: boolean = isOn) => (
    <button
      key={index}
      type="button"
      className="rating__star"
      onPointerMove={() => isInteractive && setHoverValue(index)}
      onPointerLeave={() => setHoverValue(null)}
      onClick={() => handleSelect(index)}
      aria-checked={ariaChecked}
      role={isInteractive ? 'radio' : undefined}
      aria-label={label}
      title={label}
      disabled={!isInteractive}
    >
      {renderIcon(index, isOn)}
    </button>
  );

  return (
    <div
      className={`rating rating--${size} ${isInteractive ? 'rating--interactive' : ''} ${className ?? ''}`.trim()}
      role={isInteractive ? 'radiogroup' : undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {allowZero && renderButton(0, displayValue <= 0, getItemLabel?.(0), displayValue <= 0)}
      {Array.from({ length: safeMax }, (_, index) => {
        const iconIndex = index + 1;
        const isOn = displayValue >= iconIndex;
        const itemLabel = getItemLabel?.(iconIndex);
        return renderButton(iconIndex, isOn, itemLabel);
      })}
    </div>
  );
};

export default IconRating;
