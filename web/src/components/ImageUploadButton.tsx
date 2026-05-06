// #06 Image upload button. Sits next to the textarea / send button.
// Tap → system file picker (camera or album on mobile, file dialog on
// desktop) → client-side compress → handed up via onPick.
//
// The button itself is just the picker trigger. The thumbnail preview
// and ✕ remove control live in <ImagePreview /> above the input area.

import { useCallback, useRef } from 'react';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { compressForUpload, ImageCompressError } from '../utils/imageCompress';

interface Props {
  /** Called once compression completes, with the JPEG base64 ready
   * to send to /api/chat. */
  onPick: (image: { base64: string; mime: 'image/jpeg'; previewUrl: string }) => void;
  /** Called on user-facing errors (decode failed, file too big, etc). */
  onError: (message: string) => void;
  /** Disable while a chat reply is streaming or another image is loading. */
  disabled?: boolean;
}

const MAX_INPUT_FILE_BYTES = 20 * 1024 * 1024; // 20MB before compress

export default function ImageUploadButton({ onPick, onError, disabled = false }: Props) {
  const { lang } = useLang();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = useCallback(async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    // Reset input value so picking the same file twice fires onChange.
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    if (file.size > MAX_INPUT_FILE_BYTES) {
      onError(t('imageinput.error.tooLarge', lang));
      return;
    }
    // Browser-side type check is advisory — file.type can be empty
    // for HEIC on some Safari versions. compressForUpload handles
    // the actual decode + format normalization.
    if (file.type && !file.type.startsWith('image/')) {
      onError(t('imageinput.error.notImage', lang));
      return;
    }

    let result;
    try {
      result = await compressForUpload(file);
    } catch (err) {
      const code = err instanceof ImageCompressError ? err.code : 'decode_failed';
      const errMap: Record<string, string> = {
        unsupported_format: t('imageinput.error.format', lang),
        decode_failed: t('imageinput.error.decode', lang),
        encode_failed: t('imageinput.error.encode', lang),
        too_large_after_compress: t('imageinput.error.tooLarge', lang),
      };
      onError(errMap[code] ?? t('imageinput.error.generic', lang));
      return;
    }

    // Build a preview URL from the compressed blob — small enough to
    // hold in memory without leaking. Caller is responsible for
    // URL.revokeObjectURL when the image is cleared.
    const previewUrl = URL.createObjectURL(result.blob);
    onPick({ base64: result.base64, mime: 'image/jpeg', previewUrl });
  }, [lang, onPick, onError]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // capture="environment" tells iOS Safari to prefer the rear
        // camera UI; on desktop and Android it's a no-op fallback to
        // file picker. Users can still pick from album via the iOS
        // sheet — capture is a hint, not a forced mode.
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={disabled}
      />
      <button
        type="button"
        className="image-upload-btn"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title={t('imageinput.pickLabel', lang)}
        aria-label={t('imageinput.pickLabel', lang)}
      >
        <span aria-hidden="true">📷</span>
      </button>
    </>
  );
}
