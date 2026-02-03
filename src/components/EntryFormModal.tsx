import { useEffect, useMemo, useState } from 'react';
import RatingStars from './RatingStars';
import type { FormFactor, RamyeonEntry, SpicinessLevel } from '../types/ramyeon';

interface Props {
  isOpen: boolean;
  initial?: RamyeonEntry | null;
  onClose: () => void;
  onSave: (values: Omit<RamyeonEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const defaultValues = {
  name: '',
  nameEnglish: '',
  brand: '',
  formFactor: 'packet' as FormFactor,
  rating: 3,
  spiciness: 'mild' as SpicinessLevel,
  description: '',
  imageUrl: ''
};

type FormValues = typeof defaultValues;

const clampRating = (value: number) => Math.min(5, Math.max(1, value));

const EntryFormModal = ({ isOpen, initial, onClose, onSave }: Props) => {
  const [values, setValues] = useState<FormValues>(defaultValues);
  const [error, setError] = useState('');

  const isEditing = Boolean(initial);
  const title = isEditing ? 'Edit Ramyeon' : 'Add Ramyeon';

  useEffect(() => {
    if (isOpen) {
      setValues({
        name: initial?.name ?? defaultValues.name,
        nameEnglish: initial?.nameEnglish ?? defaultValues.nameEnglish,
        brand: initial?.brand ?? defaultValues.brand,
        formFactor: initial?.formFactor ?? defaultValues.formFactor,
        rating: initial?.rating ?? defaultValues.rating,
        spiciness: initial?.spiciness ?? defaultValues.spiciness,
        description: initial?.description ?? defaultValues.description,
        imageUrl: initial?.imageUrl ?? defaultValues.imageUrl
      });
      setError('');
    }
  }, [isOpen, initial]);

  const canSubmit = useMemo(() => values.name.trim() && values.brand.trim(), [values]);

  const handleChange = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      setError('Name and brand are required.');
      return;
    }
    onSave({
      ...values,
      rating: clampRating(values.rating || 1),
      name: values.name.trim(),
      nameEnglish: values.nameEnglish.trim(),
      brand: values.brand.trim(),
      description: values.description.trim(),
      imageUrl: values.imageUrl.trim()
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__content" role="dialog" aria-modal="true">
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            x
          </button>
        </header>
        <form className="modal__form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Korean name</label>
            <input
              id="name"
              value={values.name}
              onChange={(event) => handleChange('name', event.target.value)}
              placeholder="진라면"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="nameEnglish">English name</label>
            <input
              id="nameEnglish"
              value={values.nameEnglish}
              onChange={(event) => handleChange('nameEnglish', event.target.value)}
              placeholder="Jin Ramen"
            />
          </div>
          <div className="field">
            <label htmlFor="brand">Brand</label>
            <input
              id="brand"
              value={values.brand}
              onChange={(event) => handleChange('brand', event.target.value)}
              placeholder="Ottogi"
              required
            />
          </div>
          <div className="field field--inline">
            <span className="field__label">Form factor</span>
            <div className="segmented">
              {(['packet', 'cup'] as FormFactor[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segmented__option ${values.formFactor === option ? 'is-active' : ''}`}
                  onClick={() => handleChange('formFactor', option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="field field--inline">
            <span className="field__label">Rating</span>
            <RatingStars
              value={values.rating}
              onChange={(value) => handleChange('rating', value)}
              size="lg"
              ariaLabel="Rating"
            />
          </div>
          <div className="field">
            <label htmlFor="spiciness">Spiciness</label>
            <select
              id="spiciness"
              value={values.spiciness}
              onChange={(event) => handleChange('spiciness', event.target.value as SpicinessLevel)}
            >
              <option value="mild">Mild</option>
              <option value="medium">Medium</option>
              <option value="hot">Hot</option>
              <option value="extreme">Extreme</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={values.description}
              onChange={(event) => handleChange('description', event.target.value)}
              placeholder="Brothy, slightly sweet, balanced spice..."
              rows={3}
            />
          </div>
          <div className="field">
            <label htmlFor="imageUrl">Image URL (optional)</label>
            <input
              id="imageUrl"
              value={values.imageUrl}
              onChange={(event) => handleChange('imageUrl', event.target.value)}
              placeholder="https://..."
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <footer className="modal__footer">
            <button type="button" className="button button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={!canSubmit}>
              {isEditing ? 'Save changes' : 'Add ramyeon'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default EntryFormModal;
