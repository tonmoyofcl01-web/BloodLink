ALTER TABLE `blood_requests`
  MODIFY `status` ENUM('OPEN', 'PAUSED', 'CANCELLED', 'CLOSED', 'EXPIRED', 'FULFILLED') NOT NULL DEFAULT 'OPEN',
  ADD COLUMN `organization_id` CHAR(36) NULL,
  ADD INDEX `blood_requests_organization_id_created_at_idx` (`organization_id`, `created_at`);

CREATE TABLE `organizations` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `type` ENUM('HOSPITAL', 'BLOOD_BANK') NOT NULL,
  `registration_number` VARCHAR(80) NOT NULL,
  `division` VARCHAR(80) NOT NULL,
  `district` VARCHAR(80) NOT NULL,
  `area` VARCHAR(100) NOT NULL,
  `public_contact_phone` VARCHAR(32) NOT NULL,
  `verification_info` VARCHAR(1000) NULL,
  `status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organizations_registration_number_key` (`registration_number`),
  INDEX `organizations_status_created_at_idx` (`status`, `created_at`),
  INDEX `organizations_created_by_user_id_created_at_idx` (`created_by_user_id`, `created_at`),
  CONSTRAINT `organizations_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `blood_requests`
  ADD CONSTRAINT `blood_requests_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `organization_memberships` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` ENUM('OWNER', 'MANAGER', 'STAFF') NOT NULL DEFAULT 'OWNER',
  `status` ENUM('ACTIVE', 'SUSPENDED', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organization_memberships_organization_user_key` (`organization_id`, `user_id`),
  INDEX `organization_memberships_user_id_status_idx` (`user_id`, `status`),
  INDEX `organization_memberships_organization_id_status_idx` (`organization_id`, `status`),
  CONSTRAINT `organization_memberships_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `organization_memberships_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `organization_verification_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `actor_user_id` CHAR(36) NULL,
  `action` ENUM('SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED') NOT NULL,
  `from_status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED') NULL,
  `to_status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED') NOT NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `organization_verification_events_organization_id_created_at_idx` (`organization_id`, `created_at`),
  INDEX `organization_verification_events_actor_user_id_created_at_idx` (`actor_user_id`, `created_at`),
  CONSTRAINT `organization_verification_events_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `organization_verification_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `type` ENUM('DONOR_OPPORTUNITY', 'DONOR_ACCEPTED', 'DONOR_DECLINED', 'DONOR_WITHDREW', 'REQUEST_STATUS', 'ORGANIZATION_SUBMITTED', 'ORGANIZATION_APPROVED', 'ORGANIZATION_REJECTED', 'ORGANIZATION_SUSPENDED') NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `message` VARCHAR(280) NOT NULL,
  `reference_type` VARCHAR(32) NULL,
  `reference_id` CHAR(36) NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notifications_event_key_key` (`event_key`),
  INDEX `notifications_user_id_read_at_created_at_idx` (`user_id`, `read_at`, `created_at`),
  CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
