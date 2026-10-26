CREATE TABLE IF NOT EXISTS alt_text_accessibility_evidence (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,tenant_id BIGINT UNSIGNED NOT NULL,asset_id BIGINT UNSIGNED NULL,
 occurrence_key BIGINT UNSIGNED NOT NULL DEFAULT 0,region_id VARCHAR(48) NOT NULL,kind VARCHAR(48) NOT NULL,
 version INT UNSIGNED NOT NULL,analysis_id VARCHAR(40) NOT NULL,request_key CHAR(64) NOT NULL,config_key CHAR(64) NOT NULL,
 status VARCHAR(32) NOT NULL,input_json JSON NOT NULL,result_json JSON NULL,error_code VARCHAR(64) NULL,
 job_id BIGINT UNSIGNED NULL,created_by BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY evidence_request(tenant_id,request_key),UNIQUE KEY evidence_version(tenant_id,asset_id,occurrence_key,kind,region_id,version),
 KEY evidence_read(tenant_id,asset_id,occurrence_key,kind,id),KEY evidence_job(tenant_id,job_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
