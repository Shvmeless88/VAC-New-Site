/**
 * Shrink a photo in the browser before it ever hits the network.
 *
 * Phone cameras produce 8–12MB images; ten of them would blow past Cloud Run's
 * 32MB request ceiling and time out on the rural connections a lot of our
 * customers are on. Resizing to ~1600px gets each shot to a few hundred KB,
 * which is still far more detail than an appraiser needs.
 */
export async function compressImage(
  file: File,
  maxEdge = 1600,
  quality = 0.82
): Promise<File> {
  // HEIC (default on iPhone) can't be decoded by canvas in most browsers. Send
  // it through untouched and let the server take it as-is.
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF rotation, so photos taken sideways don't
    // arrive sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height));

  // Already small enough — don't re-encode and lose quality for nothing.
  if (scale === 1 && file.size < 1_000_000) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );

  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
