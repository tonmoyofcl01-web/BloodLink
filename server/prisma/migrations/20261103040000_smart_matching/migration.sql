ALTER TABLE `blood_requests`
  MODIFY `status` ENUM('OPEN', 'PAUSED', 'CANCELLED', 'CLOSED', 'EXPIRED') NOT NULL DEFAULT 'OPEN';

CREATE TABLE `request_matches` (
  `id` CHAR(36) NOT NULL,
  `request_id` CHAR(36) NOT NULL,
  `donor_profile_id` CHAR(36) NOT NULL,
  `match_status` ENUM('NOTIFIED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'INVALIDATED', 'CLOSED') NOT NULL DEFAULT 'NOTIFIED',
  `location_rank` TINYINT UNSIGNED NOT NULL,
  `prior_notification_count` INT UNSIGNED NOT NULL,
  `last_prior_notified_at` DATETIME(3) NULL,
  `rank_factors` JSON NOT NULL,
  `notified_at` DATETIME(3) NOT NULL,
  `responded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `request_matches_request_donor_key` (`request_id`, `donor_profile_id`),
  INDEX `request_matches_request_id_match_status_idx` (`request_id`, `match_status`),
  INDEX `request_matches_donor_profile_id_match_status_created_at_idx` (`donor_profile_id`, `match_status`, `created_at`),
  INDEX `request_matches_donor_profile_id_notified_at_idx` (`donor_profile_id`, `notified_at`),
  CONSTRAINT `request_matches_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `blood_requests` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `request_matches_donor_profile_id_fkey` FOREIGN KEY (`donor_profile_id`) REFERENCES `donor_profiles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
