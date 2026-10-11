-- Forgot-password tokens (MySQL 8+). Additive and repeatable.
-- Mirrors the password_resets definition in lib/platform-schema.ts; keep both in sync.
--
-- The emailed token is random; only its SHA-256 hex digest is stored here.
-- Tokens expire after 30 minutes and are single-use (used_at is set on reset).

CREATE TABLE IF NOT EXISTS `password_resets` (
  `token_hash` CHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token_hash`),
  KEY `idx_password_resets_user` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional housekeeping:
-- DELETE FROM `password_resets` WHERE `expires_at` < UTC_TIMESTAMP() OR `used_at` IS NOT NULL;
