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
  ruled-out category: English and local names such as "Escape Game", "Exit Game", "Quest Room",
  "Fluchtraum", "Evden Kaçış Oyunu", "Szabadulószoba", "Úniková hra", "Pokój zagadek",
  "חדר בריחה", "방탈출", "脱出ゲーム", "密室逃脱"; looser ones such as "Квест", "Exit Room" or
  "Locked Room" only with an entertainment category), dropped closed places, trimmed and
  normalised fields (website scheme, rounded coordinates), merged duplicates (similar names under
  75 m apart, or a shared phone or website under 300 m), tagged cities (city regions use the
  city's name; whole-country regions other than `us` and `ca` merge spellings of one city),
  detected chains by shared website, and assigned URL slugs (Cyrillic and Greek transliterated).

## Regions

156 files, 8504 venues in 118 countries, 803 KB gzipped in all (largest: `us`,
212 KB). Every escape room in the release lands in exactly one region
(`regionForPlace` in `scripts/import/foursquare/index.ts`):

1. **City regions** (`gb-london`, `jp-tokyo`, ... 40 of them): a place inside the city's bbox. Their venues
   are tagged with the city's name, so a city has one page (`london-gb`).
2. **Whole countries** (`us`, `ca`, then every other country by ISO code: `gb`, `de`, `ru`, ...): the rest of
   the country. A country with no escape rooms has no file. In the countries added for worldwide
   coverage, Foursquare's many spellings of a city (`Москва` / `Moscow` / `Moskva`, `Thessaloniki` /
   `THESSALONIKI` / `Θεσσαλονίκη`, varying province strings) become one city page (`moscow-ru`), and a
   venue tagged with a city region's name just outside its box joins that city (`london-gb`).

Region ids, their order and existing venue slugs are stable: new regions are appended, and a
re-run keeps every venue's slug and primary Foursquare record from the committed files.
No file needs splitting (the ~1 MB limit per file is far off).

Whole-country regions with 20 or more venues:

| Region | Name | Venues | Cities | Size |
| --- | --- | ---: | ---: | ---: |
| `us` | United States | 2123 | 1135 | 212.1 KB |
| `ru` | Russia | 1064 | 108 | 84.3 KB |
| `fr` | France | 424 | 268 | 43.7 KB |
| `gb` | United Kingdom | 335 | 174 | 31.2 KB |
| `ua` | Ukraine | 330 | 29 | 25.8 KB |
| `de` | Germany | 303 | 144 | 27.8 KB |
| `ca` | Canada | 217 | 82 | 20.3 KB |
| `nl` | Netherlands | 204 | 112 | 17.9 KB |
| `cn` | China | 202 | 30 | 14.1 KB |
| `it` | Italy | 167 | 112 | 15.9 KB |
| `es` | Spain | 162 | 88 | 14.9 KB |
| `be` | Belgium | 157 | 66 | 12.3 KB |
| `pl` | Poland | 149 | 54 | 13.9 KB |
| `tr` | Türkiye | 111 | 35 | 10.0 KB |
| `ir` | Iran | 100 | 15 | 7.6 KB |
| `id` | Indonesia | 96 | 51 | 9.1 KB |
| `br` | Brazil | 73 | 39 | 7.0 KB |
| `fi` | Finland | 73 | 25 | 5.8 KB |
| `sa` | Saudi Arabia | 63 | 17 | 4.8 KB |
| `cz` | Czechia | 60 | 40 | 6.4 KB |
| `il` | Israel | 60 | 13 | 5.0 KB |
| `ch` | Switzerland | 57 | 29 | 5.3 KB |
| `ro` | Romania | 57 | 15 | 4.8 KB |
| `mx` | Mexico | 56 | 32 | 5.0 KB |
| `kr` | South Korea | 45 | 21 | 4.0 KB |
| `bg` | Bulgaria | 40 | 8 | 3.5 KB |
| `at` | Austria | 37 | 19 | 3.6 KB |
| `au` | Australia | 36 | 31 | 3.9 KB |
| `my` | Malaysia | 35 | 18 | 3.6 KB |
| `by` | Belarus | 33 | 6 | 3.1 KB |
| `rs` | Serbia | 30 | 6 | 2.6 KB |
| `vn` | Vietnam | 30 | 9 | 2.9 KB |
| `gr` | Greece | 29 | 14 | 2.9 KB |
| `se` | Sweden | 27 | 15 | 2.8 KB |
| `in` | India | 26 | 15 | 2.7 KB |
| `lv` | Latvia | 26 | 5 | 2.2 KB |
| `jp` | Japan | 25 | 17 | 3.0 KB |
| `hu` | Hungary | 24 | 18 | 2.7 KB |
| `pt` | Portugal | 22 | 9 | 2.4 KB |
| `ar` | Argentina | 21 | 9 | 2.2 KB |
| `dk` | Denmark | 21 | 18 | 2.2 KB |
| `no` | Norway | 20 | 11 | 2.1 KB |

Smaller countries (74): `hr` 18, `sk` 18, `nz` 17, `eg` 13, `kz` 11, `tw` 11, `ie` 10, `lt` 10, `co` 9, `cy` 9, `ee` 9, `ec` 8, `uz` 8, `za` 8, `ae` 6, `cl` 6, `si` 6, `lb` 5, `lu` 5, `th` 5, `jo` 4, `ke` 4, `cr` 3, `do` 3, `kh` 3, `kw` 3, `mk` 3, `pe` 3, `pr` 3, `qa` 3, `ad` 2, `bh` 2, `ge` 2, `ma` 2, `md` 2, `pa` 2, `ph` 2, `pk` 2, `py` 2, `tn` 2, `al` 1, `am` 1, `aw` 1, `ax` 1, `az` 1, `bf` 1, `bm` 1, `bn` 1, `bo` 1, `dz` 1, `ga` 1, `gh` 1, `gi` 1, `gt` 1, `im` 1, `is` 1, `jm` 1, `kg` 1, `lk` 1, `me` 1, `mt` 1, `mu` 1, `mv` 1, `ng` 1, `ni` 1, `pf` 1, `sv` 1, `sy` 1, `tt` 1, `tz` 1, `ve` 1, `vi` 1, `xk` 1, `zw` 1.

City regions: `gb-london` 69, `fr-paris` 56, `de-berlin` 28, `nl-amsterdam` 11, `es-madrid` 50, `es-barcelona` 61, `it-rome` 18, `jp-tokyo` 42, `kr-seoul` 60, `sg-singapore` 17, `hk-hong-kong` 9, `au-sydney` 24, `au-melbourne` 32, `gb-manchester` 16, `ie-dublin` 4, `pt-lisbon` 12, `be-brussels` 19, `de-munich` 13, `de-hamburg` 19, `at-vienna` 17, `ch-zurich` 11, `cz-prague` 56, `pl-warsaw` 43, `hu-budapest` 45, `dk-copenhagen` 8, `se-stockholm` 15, `it-milan` 9, `gr-athens` 48, `tr-istanbul` 32, `jp-osaka` 16, `tw-taipei` 24, `th-bangkok` 12, `my-kuala-lumpur` 21, `ph-manila` 6, `id-jakarta` 85, `ae-dubai` 18, `au-brisbane` 7, `au-perth` 10, `au-adelaide` 7, `nz-auckland` 6.

## Regenerate

```sh
NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --all --concurrency 12  # every region
NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --region us,ca # some regions
```

It streams the Parquet files over HTTP range requests, reading the small category and name
columns first and the place columns only for row groups that hold an escape room (about 7
minutes for the whole world with `--concurrency 12`; every row group is read now that every
country has a region). Per-file results are cached in `.data/import-cache/`, so an interrupted
run resumes. A `--region` run assigns places against all regions, so `--region gb` leaves
London's venues to `gb-london`. Commit the changed files; the next deploy loads them (about
4 s for all regions into PGlite, in the background, 500 rows per statement).

## Format (`format: 1`)

Each `<region>.json.gz` holds `{ format, region, source, license, attribution, generatedAt,
cities: [[slug, name, region, country, lat, lng]], venueKeys, sourceKeys, venues: [[...venueKeys,
sources]] }`. A venue's `sources` lists every merged Foursquare record: the first is
`[fsqId, dateRefreshed]` (its fields are the venue's), the others are `[fsqId, ...sourceKeys]`.
`manifest.json` lists each region's file, hash, venue and city counts, and how many raw records
were read and merged.
