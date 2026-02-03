import { useId, useMemo, useState } from 'react';

interface Props {
  value: number;
  onChange?: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
  readonly?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getFillPercentage = (rating: number, index: number) => {
  if (rating >= index) return 100;
  if (rating >= index - 0.5) return 50;
  return 0;
};

const RatingStars = ({ value, onChange, size = 'md', ariaLabel, readonly }: Props) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value;
  const isInteractive = Boolean(onChange) && !readonly;
  const gradientId = useId();

  const sizes = useMemo(() => {
    switch (size) {
      case 'sm':
        return { width: 16, height: 16 };
      case 'lg':
        return { width: 26, height: 26 };
      default:
        return { width: 20, height: 20 };
    }
  }, [size]);

  const handlePointer = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (!isInteractive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const nextValue = percent <= 0.5 ? index - 0.5 : index;
    setHoverValue(nextValue);
  };

  const handleSelect = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (!isInteractive || !onChange) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const nextValue = percent <= 0.5 ? index - 0.5 : index;
    onChange(nextValue);
  };

  return (
    <div
      className={`rating rating--${size} ${isInteractive ? 'rating--interactive' : ''}`}
      role={isInteractive ? 'radiogroup' : undefined}
      aria-label={ariaLabel}
    >
      {[1, 2, 3, 4, 5].map((index) => {
        const fill = getFillPercentage(displayValue, index);
        return (
          <button
            key={index}
            type="button"
            className="rating__star"
            onPointerMove={(event) => handlePointer(event, index)}
            onPointerLeave={() => setHoverValue(null)}
            onPointerDown={(event) => handleSelect(event, index)}
            aria-checked={displayValue >= index - 0.5}
            role={isInteractive ? 'radio' : undefined}
            aria-label={`${index} star${index > 1 ? 's' : ''}`}
            disabled={!isInteractive}
          >
            <svg
              width={sizes.width}
              height={sizes.height}
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="rating__icon"
            >
              <defs>
                <linearGradient id={`${gradientId}-star-${index}-${fill}`} x1="0" x2="1">
                  <stop offset={`${fill}%`} stopColor="currentColor" />
                  <stop offset={`${fill}%`} stopColor="transparent" />
                </linearGradient>
              </defs>
              <path
                d="M12 2.5l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 19.3l1-6.1L3.2 8.9l6.1-.9L12 2.5z"
                fill={`url(#${gradientId}-star-${index}-${fill})`}
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
};

export default RatingStars;
