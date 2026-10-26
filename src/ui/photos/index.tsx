/**
 * Photo upload UI (workstream 24): pick, resize in the browser (~1600 px, < 400 KB), upload via
 * ROUTES.uploadPhoto (multipart field `photo`). STUB.
 */
export function PhotoUploader(_props: { visitId: string; onUploaded?(photoId: string): void }) {
  return <div data-testid="photo-uploader" />
}

/** Resize to fit `maxPx` on the long side and re-encode as JPEG/WebP. STUB: returns the file unchanged. */
export async function resizeImage(file: Blob, _maxPx = 1600): Promise<Blob> {
  return file
}
