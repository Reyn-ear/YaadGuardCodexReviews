CREATE TABLE IF NOT EXISTS `storm_history_points` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `storm_id` text NOT NULL,
  `storm_name` text NOT NULL,
  `storm_date` text NOT NULL,
  `storm_time` text NOT NULL,
  `record_id` text,
  `status` text NOT NULL,
  `lat` real NOT NULL,
  `lon` real NOT NULL,
  `wind_kt` integer NOT NULL,
  `pressure_mb` integer
);

CREATE INDEX IF NOT EXISTS `storm_history_points_lat_lon_idx`
  ON `storm_history_points` (`lat`, `lon`);

CREATE INDEX IF NOT EXISTS `storm_history_points_storm_id_date_time_idx`
  ON `storm_history_points` (`storm_id`, `storm_date`, `storm_time`);

CREATE TABLE IF NOT EXISTS `surge_return_levels` (
  `station_id` integer PRIMARY KEY NOT NULL,
  `lat` real NOT NULL,
  `lon` real NOT NULL,
  `rp1_bestfit` real NOT NULL,
  `rp1_lower5` real NOT NULL,
  `rp1_upper95` real NOT NULL,
  `rp2_bestfit` real NOT NULL,
  `rp2_lower5` real NOT NULL,
  `rp2_upper95` real NOT NULL,
  `rp5_bestfit` real NOT NULL,
  `rp5_lower5` real NOT NULL,
  `rp5_upper95` real NOT NULL,
  `rp10_bestfit` real NOT NULL,
  `rp10_lower5` real NOT NULL,
  `rp10_upper95` real NOT NULL,
  `rp25_bestfit` real NOT NULL,
  `rp25_lower5` real NOT NULL,
  `rp25_upper95` real NOT NULL,
  `rp50_bestfit` real NOT NULL,
  `rp50_lower5` real NOT NULL,
  `rp50_upper95` real NOT NULL,
  `rp75_bestfit` real NOT NULL,
  `rp75_lower5` real NOT NULL,
  `rp75_upper95` real NOT NULL,
  `rp100_bestfit` real NOT NULL,
  `rp100_lower5` real NOT NULL,
  `rp100_upper95` real NOT NULL,
  `eva_scale` real NOT NULL,
  `eva_shape` real NOT NULL,
  `eva_loc` real NOT NULL
);

CREATE TABLE IF NOT EXISTS `terrain_summaries` (
  `tile_name` text PRIMARY KEY NOT NULL,
  `source_key` text NOT NULL,
  `min_elevation_m` real NOT NULL,
  `max_elevation_m` real NOT NULL,
  `mean_elevation_m` real NOT NULL,
  `land_coverage_pct` real NOT NULL,
  `pixel_count` integer NOT NULL,
  `valid_pixel_count` integer NOT NULL,
  `land_pixel_count` integer NOT NULL,
  `source_updated_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS `terrain_summaries_source_key_idx`
  ON `terrain_summaries` (`source_key`);

CREATE TABLE IF NOT EXISTS `worldpop_country_payloads` (
  `worldpop_id` integer PRIMARY KEY NOT NULL,
  `dataset_alias` text NOT NULL,
  `iso3` text NOT NULL,
  `country_name` text NOT NULL,
  `continent` text,
  `population_year` integer NOT NULL,
  `source_date` text,
  `payload` text NOT NULL,
  `synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `worldpop_country_payloads_dataset_iso3_year_idx`
  ON `worldpop_country_payloads` (
    `dataset_alias`,
    `iso3`,
    `population_year`
  );

CREATE INDEX IF NOT EXISTS `worldpop_country_payloads_iso3_year_idx`
  ON `worldpop_country_payloads` (`iso3`, `population_year`);

CREATE INDEX IF NOT EXISTS `worldpop_country_payloads_dataset_idx`
  ON `worldpop_country_payloads` (`dataset_alias`);

CREATE TABLE IF NOT EXISTS `ingestion_runs` (
  `run_id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL,
  `requested_by` text,
  `source_ids` text NOT NULL,
  `manifest_key` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS `ingestion_source_jobs` (
  `run_id` text NOT NULL,
  `source_id` text NOT NULL,
  `action` text NOT NULL,
  `status` text NOT NULL,
  `source_version` text,
  `raw_object_key` text,
  `generated_prefix` text,
  `message` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  PRIMARY KEY (`run_id`, `source_id`, `action`)
);
