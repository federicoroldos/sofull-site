import RatingStars from './RatingStars';
import SpiceMeter from './SpiceMeter';
import type { RamyeonEntry } from '../types/ramyeon';

interface Props {
  entry: RamyeonEntry;
  onEdit: (entry: RamyeonEntry) => void;
  onDelete: (entry: RamyeonEntry) => void;
  canEdit: boolean;
}

const EntryCard = ({ entry, onEdit, onDelete, canEdit }: Props) => {
  const hasEnglish = entry.nameEnglish && entry.nameEnglish.trim().length > 0;
  const displayName = hasEnglish ? `${entry.name} (${entry.nameEnglish})` : entry.name;

  return (
    <article className="entry-card">
      <div className="entry-card__image">
        {entry.imageUrl ? (
          <img src={entry.imageUrl} alt={entry.name} />
        ) : (
          <span>pic</span>
        )}
      </div>
      <div className="entry-card__content">
        <div className="entry-card__header">
          <div>
            <h3>{displayName}</h3>
            <p className="entry-card__meta">
              <span className="pill pill--brand">{entry.brand}</span>
              <span className="pill">{entry.formFactor}</span>
            </p>
          </div>
          <div className="entry-card__rating">
            <RatingStars value={entry.rating} readonly size="sm" />
          </div>
        </div>
        <p className="entry-card__description">
          {entry.description?.trim() || 'No description yet. Add your tasting notes.'}
        </p>
        <div className="entry-card__footer">
          <SpiceMeter level={entry.spiciness} />
          <div className="entry-card__actions">
            <button
              type="button"
              className="text-button"
              onClick={() => onEdit(entry)}
              disabled={!canEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={() => onDelete(entry)}
              disabled={!canEdit}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

export default EntryCard;
