import { useEffect, useMemo, useRef, useState } from 'react';
import IconRating from './IconRating';
import RatingStars from './RatingStars';
import { ATTRIBUTE_LEVELS, getAttributeIcon, getAttributeLabel, getAttributeLevelLabel, getAttributeValue } from '../utils/attribute';
import { sanitizeUrl } from '../utils/sanitize';
import type { EntryCategory, FormFactor, IceCreamFormFactor, RamyeonEntry, SpicinessLevel } from '../types/ramyeon';

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
  category: EntryCategory;
  formFactor: FormFactor;
  iceCreamFormFactor: IceCreamFormFactor;
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
  category: 'ramyeon' as EntryCategory,
  formFactor: 'packet' as FormFactor,
  iceCreamFormFactor: 'bar' as IceCreamFormFactor,
  rating: 5,
  spiciness: 'extreme' as SpicinessLevel,
  description: '',
  imageUrl: ''
};

type FormValues = typeof defaultValues;

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const clampRating = (value: number) => Math.min(5, Math.max(1, value));
const CATEGORY_PLACEHOLDERS: Record<
  EntryCategory,
  { name: string; nameEnglish: string; brand: string; description: string }
> = {
  ramyeon: {
    name: '신라면',
    nameEnglish: 'Shin Ramyeon',
    brand: 'Nongshim',
    description: 'Spicy, savory, chewy noodles.'
  },
  snack: {
    name: '초코파이',
    nameEnglish: 'Choco Pie',
    brand: 'Orion',
    description: 'Sweet, soft, chocolate-coated treat.'
  },
  drink: {
    name: '바나나우유',
    nameEnglish: 'Banana Milk',
    brand: 'Binggrae',
    description: 'Sweet, creamy, banana-flavored milk.'
  },
  ice_cream: {
    name: '메로나',
    nameEnglish: 'Melona',
    brand: 'Binggrae',
    description: 'Melon-flavored, creamy ice bar.'
  }
};

const EntryFormModal = ({ isOpen, initial, initialImageSrc, onClose, onSave }: Props) => {
  const [values, setValues] = useState<FormValues>(defaultValues);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState('');
  const [clearImage, setClearImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = Boolean(initial);
  const title = isEditing ? 'Edit Item' : 'Add Item';
  const isRamyeon = values.category === 'ramyeon';
  const isIceCream = values.category === 'ice_cream';
  const attributeLabel = getAttributeLabel(values.category);
  const attributeLevelLabel = getAttributeLevelLabel(values.category, values.spiciness);
  const attributeValue = getAttributeValue(values.spiciness);
  const attributeMax = ATTRIBUTE_LEVELS.length - 1;
  const baseRenderAttributeIcon = getAttributeIcon(values.category);
  const renderAttributeIcon = (index: number, isOn: boolean) => {
    if (index === 0) {
      const zeroClass =
        values.category === 'ice_cream'
          ? 'spice__pepper--zero-ice-cream'
          : values.category === 'drink'
          ? 'spice__pepper--zero-drink'
          : values.category === 'snack'
          ? 'spice__pepper--zero-snack'
          : 'spice__pepper--zero';
      if (
        values.category === 'ramyeon' ||
        values.category === 'ice_cream' ||
        values.category === 'drink' ||
        values.category === 'snack'
      ) {
        return (
          <span
            className={['spice__pepper', zeroClass, isOn ? 'spice__pepper--on' : '']
              .filter(Boolean)
              .join(' ')}
          />
        );
      }
    }
    return baseRenderAttributeIcon(index, isOn);
  };
  const placeholderCategory = values.category ?? 'ramyeon';
  const placeholders = CATEGORY_PLACEHOLDERS[placeholderCategory] ?? CATEGORY_PLACEHOLDERS.ramyeon;

  useEffect(() => {
    if (!isOpen) return;
    setValues({
      name: initial?.name ?? defaultValues.name,
      nameEnglish: initial?.nameEnglish ?? defaultValues.nameEnglish,
      brand: initial?.brand ?? defaultValues.brand,
      category: initial?.category ?? defaultValues.category,
      formFactor: initial?.formFactor ?? defaultValues.formFactor,
      iceCreamFormFactor: initial?.iceCreamFormFactor ?? defaultValues.iceCreamFormFactor,
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
              placeholder={placeholders.name}
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
              placeholder={placeholders.nameEnglish}
              disabled={isSubmitting}
            />
          </div>
          <div className="field">
            <label htmlFor="brand">Brand</label>
            <input
              id="brand"
              value={values.brand}
              onChange={(event) => handleChange('brand', event.target.value)}
              placeholder={placeholders.brand}
              required
              disabled={isSubmitting}
            />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select
              id="category"
              value={values.category}
              onChange={(event) => handleChange('category', event.target.value as EntryCategory)}
              disabled={isSubmitting}
            >
              <option value="ramyeon">Ramyeon</option>
              <option value="snack">Snack</option>
              <option value="drink">Drink</option>
              <option value="ice_cream">Ice cream</option>
            </select>
          </div>
          {isRamyeon && (
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
          )}
          {isIceCream && (
            <div className="field field--inline">
              <span className="field__label">Form factor</span>
              <div className="segmented">
                {(['bar', 'cream'] as IceCreamFormFactor[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`segmented__option ${values.iceCreamFormFactor === option ? 'is-active' : ''}`}
                    onClick={() => handleChange('iceCreamFormFactor', option)}
                    disabled={isSubmitting}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field field--inline">
            <span className="field__label">Rating</span>
            <RatingStars
              value={values.rating}
              onChange={(value) => handleChange('rating', value)}
              size="lg"
              ariaLabel="Rating"
            />
          </div>
          <div className="field field--inline">
            <span id="spiciness-label" className="field__label">
              {attributeLabel}
            </span>
            <IconRating
              value={attributeValue}
              max={attributeMax}
              onChange={(nextValue) =>
                handleChange('spiciness', ATTRIBUTE_LEVELS[Math.min(Math.max(nextValue, 0), attributeMax)])
              }
              renderIcon={renderAttributeIcon}
              getItemLabel={(index) => getAttributeLevelLabel(values.category, ATTRIBUTE_LEVELS[index])}
              ariaLabel={`${attributeLabel} ${attributeLevelLabel}`}
              ariaLabelledBy="spiciness-label"
              size="lg"
              disabled={isSubmitting}
              allowZero
            />
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={values.description}
              onChange={(event) => handleChange('description', event.target.value)}
              placeholder={placeholders.description}
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
                <img src={previewImageSrc} alt="Selected item preview" />
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
              {isSubmitting ? 'Saving...' : isEditing ? 'Save changes' : 'Add item'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default EntryFormModal;

