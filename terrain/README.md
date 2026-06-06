# GEDTM30 candidate release

The checked-in source manifest is intentionally incomplete. Copy it outside the
repository, replace every `REQUIRED` value with metadata from one immutable
GEDTM30 artifact, and point `localRasterPath` at the matching COG.

Local build and validation create a pinned Python environment under the ignored
`terrain/cache/` directory. The `pmtiles` and `martin` CLIs must be on `PATH`.

```sh
npm run terrain:build:local -- --source-manifest /path/to/source.json \
  --evaluation-report /path/to/evaluation-report.json \
  --artifact-version gedtm30-v20250130 --run-id evaluation-001
npm run terrain:serve:local -- --release generated/gedtm30-v20250130/evaluation-001
npm run terrain:validate:local -- --release generated/gedtm30-v20250130/evaluation-001
```

The current Jamaica evaluation release can be served with:

```sh
npm run terrain:serve:local -- \
  --release generated/gedtm30-v1.2-jamaica/local-20260606
npm run dev
```

Martin listens on `127.0.0.1:3010` by default. The ignored `.env.local` points
development terrain rendering at its `jamaica` TileJSON source.

Remote commands require `TERRAIN_R2_BUCKET` and the normal Wrangler
authentication. Publication and activation reject releases whose local or
remote validation records do not match the release identity and checksums.
Activation additionally requires an evaluation report with `decision: "adopt"`
and every representative-area and adoption gate set to `true`.

`npm run dev:remote-data` selects GEDTM30 and reads the immutable Caribbean
PMTiles archive directly from the bucket's public `r2.dev` endpoint. The
optimized archive uses 512 pixel tiles at zooms 5-11, which preserves the
original zoom-12 ground detail while reducing browser range requests. Tile
payloads use lossless RGB WebP, preserving every encoded elevation value while
reducing the archive size. The Worker route at
`/api/terrain/gedtm30.pmtiles` remains available as a fallback using
`TERRAIN_PMTILES_KEY`, so candidate testing does not require changing
`manifests/active.json`.

Generated release directories and source rasters are ignored by Git.
