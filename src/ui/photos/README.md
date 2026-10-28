# Photos (workstream 24, Phase 3 workstream A)

Browser side of visit photos. Light (no three.js): the phone app uses it too.

## Files
| File | What |
| --- | --- |
| `resize.ts` | `resizePhoto(file)`: decode (EXIF rotation applied), fit the long side to 1600 px and re-encode as JPEG under ~400 KB, shrinking further if needed (server ceiling 1 MB). |
| `upload.ts` | `uploadPhotoWithProgress(visitId, photo, { onProgress, signal })`: multipart `POST /api/visits/:id/photos` via XMLHttpRequest (fetch has no upload progress); errors are `ApiCallError`s. `uploadErrorMessage`, `isPermanentUploadError`. |
| `queue.ts` | `usePhotoQueue`: one Zustand store for every pending photo in the app, so uploads keep going after the form that started them closes. |
| `PhotoAttach.tsx` | The "Add photos" control: picker (and drop target on desktops), thumbnails, remove (a small dot in a 40 px corner tap target), per-photo progress bar, Retry / Retry all, "N of 30", a polite live status line that also lists skipped files ("notes.txt isn't a photo, so it was skipped."). |
| `index.tsx` | Exports, plus the older `PhotoUploader` and `PhotoGrid`. |

## The queue
- Items have a *target*: `draft:<key>` (`newDraftTarget()`) before the visit exists, or `visit:<id>` (`visitTarget(id)`).
- `addFiles(target, files, { slots })` refuses non-images, originals over 40 MB, and anything past the per-visit limit (30, the server's `MAX_PHOTOS_PER_VISIT`); it resizes the rest one at a time (decoding many 12 MP photos at once can run a phone out of memory) and shows the resized JPEG as the thumbnail.
- Only `visit:` items upload, one at a time, oldest first. `attachToVisit(draftTarget, visitId)` moves a draft's photos onto the visit and starts them: that is "upload right after save". A failed item stays on the visit with its message; Retry re-queues it (or re-resizes it if resizing failed). Errors a retry can't fix (wrong type, visit full, not allowed) hide Retry.
- `remove(key)` cancels an upload in flight. Removing an uploaded photo in `PhotoAttach` (uploader only) hides it at once with "Photo removed · Undo"; the server delete waits `removeUndoMs()` (5 s), and happens at once when another photo is removed or the control unmounts. A failed delete puts the photo back with the reason. `clear(target)` drops a draft when its form is discarded.
- `watchTarget(target)` (returns its release): finished uploads stay in the queue only while something shows them (`PhotoAttach` while mounted, `followUploads` until it has toasted). When nobody does, the finished items (resized JPEG, object URL) are let go: the photo is on the server and every list refetches it. Failed items always stay, for Retry.
- `onPhotoUploaded(fn)` tells listeners (the 3D room's store sync in `src/ui/review/photoSync.ts`).
- Tests: `configurePhotoQueue({ resize, upload, createUrl, revokeUrl, undoMs })` swaps the dependencies, `resetPhotoQueueForTests()` restores them.

## Where it is used
- Desktop confirm overlay (`src/ui/confirm`) and the phone log flow (`src/mobile/log`): queued while writing, uploaded right after save; the phone's "Saved!" screen shows progress and takes more.
- The 3D room's review overlay (`src/ui/review/VisitPhotos.tsx`) and the phone's room page (`src/mobile/list`, participants only): add to an existing visit, remove your own.
