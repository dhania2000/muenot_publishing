-- Platform auth: email + password users and server-side sessions (MySQL 8+).
-- Additive and repeatable (CREATE TABLE IF NOT EXISTS); existing data is untouched.
-- Mirrors the users / app_sessions definitions in lib/platform-schema.ts exactly,
-- so migration-based deploys and runtime bootstrap produce the same schema.
-- Keep both in sync.
--
-- Passwords are never stored in plain text: password_hash holds the hash
-- produced by the app at sign-up. Session cookies are random tokens; only
-- their SHA-256 hex digest is stored in app_sessions.token_hash.

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `email` VARCHAR(255) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','employee') NOT NULL DEFAULT 'employee',
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_users_email` (`email`),
  KEY `idx_users_tenant` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `app_sessions` (
  `token_hash` CHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token_hash`),
  KEY `idx_sessions_user` (`user_id`),
  KEY `idx_sessions_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional housekeeping: remove expired sessions (the app also prunes per user on login).
-- DELETE FROM `app_sessions` WHERE `expires_at` < UTC_TIMESTAMP();
