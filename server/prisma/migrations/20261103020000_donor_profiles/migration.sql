CREATE TABLE IF NOT EXISTS `blood_groups` (
  `id` SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(3) NOT NULL,
  `display_name` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `blood_groups_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `donor_profiles` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `blood_group_id` SMALLINT UNSIGNED NOT NULL,
  `division` VARCHAR(80) NOT NULL,
  `district` VARCHAR(80) NOT NULL,
  `area` VARCHAR(100) NOT NULL,
  `availability_status` ENUM('AVAILABLE', 'PAUSED') NOT NULL DEFAULT 'PAUSED',
  `discovery_consent_at` DATETIME(3) NULL,
  `consent_version` VARCHAR(32) NULL,
  `consent_updated_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `donor_profiles_user_id_key` (`user_id`),
  INDEX `donor_profiles_blood_group_avail_consent_idx` (`blood_group_id`, `availability_status`, `discovery_consent_at`),
  INDEX `donor_profiles_division_district_area_idx` (`division`, `district`, `area`),
  CONSTRAINT `donor_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `donor_profiles_blood_group_id_fkey` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
