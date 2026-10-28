# Photos (workstream 24, Phase 3 workstream A)

Browser side of visit photos. Light (no three.js): the phone app uses it too.

## Files
| File | What |
| --- | --- |
| `resize.ts` | `resizePhoto(file)`: decode (EXIF rotation applied), fit the long side to 1600 px and re-encode as JPEG under ~400 KB, shrinking further if needed (server ceiling 1 MB). |
| `upload.ts` | `uploadPhotoWithProgress(visitId, photo, { onProgress, signal })`: multipart `POST /api/visits/:id/photos` via XMLHttpRequest (fetch has no upload progress); errors are `ApiCallError`s. `uploadErrorMessage`, `isPermanentUploadError`. |
| `queue.ts` | `usePhotoQueue`: one Zustand store for every pending photo in the app, so uploads keep going after the form that started them closes. |
| `PhotoAttach.tsx` | The "Add photos" control: picker (and drop target on desktops), thumbnails, remove, per-photo progress bar, Retry / Retry all, "N of 30", a polite live status line. |
| `index.tsx` | Exports, plus the older `PhotoUploader` and `PhotoGrid`. |

## The queue
- Items have a *target*: `draft:<key>` (`newDraftTarget()`) before the visit exists, or `visit:<id>` (`visitTarget(id)`).
- `addFiles(target, files, { slots })` refuses non-images, originals over 40 MB, and anything past the per-visit limit (30, the server's `MAX_PHOTOS_PER_VISIT`); it resizes the rest one at a time (decoding many 12 MP photos at once can run a phone out of memory) and shows the resized JPEG as the thumbnail.
- Only `visit:` items upload, one at a time, oldest first. `attachToVisit(draftTarget, visitId)` moves a draft's photos onto the visit and starts them: that is "upload right after save". A failed item stays on the visit with its message; Retry re-queues it (or re-resizes it if resizing failed). Errors a retry can't fix (wrong type, visit full, not allowed) hide Retry.
- `remove(key)` cancels an upload in flight; removing a finished photo in `PhotoAttach` deletes it on the server (uploader only). `clear(target)` drops a draft when its form is discarded.
- `onPhotoUploaded(fn)` tells listeners (the 3D room's store sync in `src/ui/review/photoSync.ts`).
- Tests: `configurePhotoQueue({ resize, upload, createUrl, revokeUrl })` swaps the dependencies, `resetPhotoQueueForTests()` restores them.

## Where it is used
- Desktop confirm overlay (`src/ui/confirm`) and the phone log flow (`src/mobile/log`): queued while writing, uploaded right after save; the phone's "Saved!" screen shows progress and takes more.
- The 3D room's review overlay (`src/ui/review/VisitPhotos.tsx`) and the phone's room page (`src/mobile/list`, participants only): add to an existing visit, remove your own.
