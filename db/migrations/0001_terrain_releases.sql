CREATE TABLE IF NOT EXISTS `terrain_analysis_cells` (
  `cell_id` text NOT NULL,
  `source_release` text NOT NULL,
  `west` real NOT NULL,
  `south` real NOT NULL,
  `east` real NOT NULL,
  `north` real NOT NULL,
  `center_lng` real NOT NULL,
  `center_lat` real NOT NULL,
  `min_elevation_m` real,
  `max_elevation_m` real,
  `mean_elevation_m` real,
  `relief_m` real,
  `land_coverage_pct` real NOT NULL,
  `valid_sample_count` integer NOT NULL,
  `sample_count` integer NOT NULL,
  `median_slope_deg` real,
  `terrain_position` real,
  `detail_object_key` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`cell_id`, `source_release`)
);

CREATE INDEX IF NOT EXISTS `terrain_analysis_cells_release_idx`
  ON `terrain_analysis_cells` (`source_release`);

CREATE INDEX IF NOT EXISTS `terrain_analysis_cells_center_idx`
  ON `terrain_analysis_cells` (`center_lng`, `center_lat`);

CREATE INDEX IF NOT EXISTS `terrain_analysis_cells_bounds_idx`
  ON `terrain_analysis_cells` (`west`, `east`, `south`, `north`);
