-- Admin approval for new accounts.
-- New sign-ups are created with status = 'pending' and cannot sign in until an
-- administrator sets them to 'active'. Existing users keep their current status.

ALTER TABLE users
  MODIFY status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending';

ALTER TABLE users
  ADD COLUMN approved_by BIGINT UNSIGNED NULL AFTER status,
  ADD COLUMN approved_at DATETIME NULL AFTER approved_by;
