# Directory seed (Foursquare Open Source Places)

Escape-room venues for the public directory, one gzipped file per region plus `manifest.json`.
The server loads them into Postgres in the background on deploy when the directory has no
imported venues yet or the manifest `version` changed (`server/routes/directory.seed.ts`).

- **Source:** Foursquare Open Source Places, release 2025-02-06, read from the Fused mirror on
  Source Cooperative (`s3://us-west-2.opendata.source.coop/fused/fsq-os-places/2025-02-06/places`).
  The official Hugging Face copy (`foursquare/fsq-os-places`) is gated and needs `HF_TOKEN`.
- **Licence:** Apache-2.0. `LICENSE.txt` and Foursquare's `NOTICE.txt` must stay next to the data.
  Public pages show "Venue data from Foursquare Open Source Places" with a link.
- **Changes we made to the data** (the notice of modifications the licence asks for): kept only
  escape rooms (category `Arts and Entertainment > Escape Room`, or an escape-room name not in a
  ruled-out category), dropped closed places, trimmed and normalised fields (website scheme,
  rounded coordinates), merged duplicates (similar names under 75 m apart, or a shared phone or
  website under 300 m), tagged cities (city regions use the city's name), detected chains by
  shared website, and assigned URL slugs.

## Regenerate

```sh
NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --all          # every region
NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --region us,ca # some regions
```

It streams the Parquet files over HTTP range requests, reading the small category and name
columns first and the place columns only for row groups that hold an escape room (about 4
minutes for all regions). Per-file results are cached in `.data/import-cache/`, so an interrupted
run resumes. Commit the changed files; the next deploy loads them.

## Format (`format: 1`)

Each `<region>.json.gz` holds `{ format, region, source, license, attribution, generatedAt,
cities: [[slug, name, region, country, lat, lng]], venueKeys, sourceKeys, venues: [[...venueKeys,
sources]] }`. A venue's `sources` lists every merged Foursquare record: the first is
`[fsqId, dateRefreshed]` (its fields are the venue's), the others are `[fsqId, ...sourceKeys]`.
`manifest.json` lists each region's file, hash, venue and city counts, and how many raw records
were read and merged.
