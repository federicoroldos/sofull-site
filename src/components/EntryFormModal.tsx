import { useEffect, useMemo, useRef, useState } from 'react';
import RatingStars from './RatingStars';
import { sanitizeUrl } from '../utils/sanitize';
import type { FormFactor, RamyeonEntry, SpicinessLevel } from '../types/ramyeon';

interface Props {
  isOpen: boolean;
  initial?: RamyeonEntry | null;
  initialImageSrc?: string;
  onClose: () => void;
  onSave: (values: EntryFormSubmitValues) => Promise<void>;
}

export interface EntryFormSubmitValues {
  name: string;
  nameEnglish: string;
  brand: string;
  formFactor: FormFactor;
  rating: number;
  spiciness: SpicinessLevel;
  description: string;
  imageUrl: string;
  imageFile: File | null;
  clearImage: boolean;
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

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const clampRating = (value: number) => Math.min(5, Math.max(1, value));

const EntryFormModal = ({ isOpen, initial, initialImageSrc, onClose, onSave }: Props) => {
  const [values, setValues] = useState<FormValues>(defaultValues);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState('');
  const [clearImage, setClearImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = Boolean(initial);
  const title = isEditing ? 'Edit Ramyeon' : 'Add Ramyeon';

  useEffect(() => {
    if (!isOpen) return;
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
    setIsSubmitting(false);
    setSelectedImageFile(null);
    setSelectedImagePreviewUrl('');
    setClearImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [isOpen, initial]);

  useEffect(() => () => {
    if (selectedImagePreviewUrl) {
      URL.revokeObjectURL(selectedImagePreviewUrl);
    }
  }, [selectedImagePreviewUrl]);

  const canSubmit = useMemo(() => values.name.trim() && values.brand.trim(), [values]);

  const handleChange = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const clearLocalImage = () => {
    if (selectedImagePreviewUrl) {
      URL.revokeObjectURL(selectedImagePreviewUrl);
    }
    setSelectedImageFile(null);
    setSelectedImagePreviewUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please choose a valid image file.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError('Image size must be 8MB or less.');
      event.target.value = '';
      return;
    }

    clearLocalImage();
    setSelectedImageFile(file);
    setSelectedImagePreviewUrl(URL.createObjectURL(file));
    setClearImage(false);
    setError('');
  };

  const handleRemoveImage = () => {
    clearLocalImage();
    setClearImage(true);
    setValues((prev) => ({ ...prev, imageUrl: '' }));
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      setError('Name and brand are required.');
      return;
    }
    const cleanedImageUrl = sanitizeUrl(values.imageUrl);
    if (values.imageUrl.trim() && !cleanedImageUrl) {
      setError('Image URL must start with https://');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await onSave({
        ...values,
        rating: clampRating(values.rating || 1),
        name: values.name.trim(),
        nameEnglish: values.nameEnglish.trim(),
        brand: values.brand.trim(),
        description: values.description.trim(),
        imageUrl: cleanedImageUrl,
        imageFile: selectedImageFile,
        clearImage
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Could not save entry.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasInitialImage = Boolean(initialImageSrc);
  const previewImageSrc = selectedImagePreviewUrl || sanitizeUrl(values.imageUrl) || (!clearImage ? initialImageSrc || '' : '');
  const canRemoveImage = Boolean(previewImageSrc || selectedImageFile || values.imageUrl.trim() || hasInitialImage);

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__content" role="dialog" aria-modal="true">
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} disabled={isSubmitting} aria-label="Close modal">
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
              disabled={isSubmitting}
            />
          </div>
          <div className="field">
            <label htmlFor="nameEnglish">English name</label>
            <input
              id="nameEnglish"
              value={values.nameEnglish}
              onChange={(event) => handleChange('nameEnglish', event.target.value)}
              placeholder="Jin Ramen"
              disabled={isSubmitting}
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
              disabled={isSubmitting}
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
                  disabled={isSubmitting}
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
              disabled={isSubmitting}
            >
              <option value="not-spicy">Not spicy</option>
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
              disabled={isSubmitting}
            />
          </div>
          <div className="field">
            <label htmlFor="imageUrl">Image URL (optional)</label>
            <div className="field__row">
              <input
                id="imageUrl"
                value={values.imageUrl}
                onChange={(event) => {
                  setClearImage(false);
                  handleChange('imageUrl', event.target.value);
                }}
                placeholder="https://..."
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="button button--ghost button--compact"
                onClick={handleUploadClick}
                disabled={isSubmitting}
                aria-label="Upload image from device"
              >
                Upload...
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp"
              onChange={handleImageFileChange}
              className="sr-only"
              aria-label="Choose image file"
              disabled={isSubmitting}
              tabIndex={-1}
            />
          </div>
          {previewImageSrc && (
            <div className="field modal__image-field">
              <div className="entry-card__image modal__image-preview">
                <img src={previewImageSrc} alt="Selected ramyeon preview" />
              </div>
              <button
                type="button"
                className="text-button"
                onClick={handleRemoveImage}
                disabled={isSubmitting || !canRemoveImage}
                aria-label="Remove selected image"
              >
                Remove image
              </button>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <footer className="modal__footer">
            <button type="button" className="button button--ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save changes' : 'Add ramyeon'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default EntryFormModal;
