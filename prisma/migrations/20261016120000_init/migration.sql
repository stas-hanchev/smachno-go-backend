CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `email_verified_at` DATETIME(3) NULL,
    `password_hash` VARCHAR(255) NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(100) NULL,
    `phone` VARCHAR(20) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `role` ENUM('customer', 'admin', 'super_admin') NOT NULL DEFAULT 'customer',
    `status` ENUM('active', 'blocked', 'deleted') NOT NULL DEFAULT 'active',
    `home_lat` DECIMAL(9, 6) NULL,
    `home_lng` DECIMAL(9, 6) NULL,
    `home_address` VARCHAR(255) NULL,
    `search_radius_km` TINYINT UNSIGNED NOT NULL DEFAULT 5,
    `city_id` BIGINT UNSIGNED NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_city_id_idx`(`city_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `oauth_accounts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `provider` ENUM('google') NOT NULL,
    `provider_user_id` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oauth_accounts_user_id_idx`(`user_id`),
    UNIQUE INDEX `oauth_accounts_provider_provider_user_id_key`(`provider`, `provider_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `refresh_tokens` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(26) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip` VARBINARY(16) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `auth_tokens` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('email_verify', 'password_reset', 'staff_invite') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `payload` JSON NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_tokens_user_id_type_idx`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `cities` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `center_lat` DECIMAL(9, 6) NOT NULL,
    `center_lng` DECIMAL(9, 6) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `cities_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `categories` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `icon` VARCHAR(50) NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `categories_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `tags` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `tags_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `allergens` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `allergens_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `levels` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `min_saved_count` INTEGER NOT NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `achievements` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `icon` VARCHAR(50) NULL,
    `rule` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `achievements_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `partner_applications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `business_name` VARCHAR(255) NOT NULL,
    `venue_type` VARCHAR(50) NOT NULL,
    `contact_name` VARCHAR(255) NOT NULL,
    `contact_phone` VARCHAR(20) NOT NULL,
    `contact_email` VARCHAR(255) NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    `legal_name` VARCHAR(255) NOT NULL,
    `tax_id` VARCHAR(255) NOT NULL,
    `iban` VARCHAR(255) NOT NULL,
    `venues_count` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `status` ENUM('submitted', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
    `reviewed_by` BIGINT UNSIGNED NULL,
    `reject_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,

    INDEX `partner_applications_user_id_idx`(`user_id`),
    INDEX `partner_applications_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `venues` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(120) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `city_id` BIGINT UNSIGNED NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    `lat` DECIMAL(9, 6) NOT NULL,
    `lng` DECIMAL(9, 6) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `logo_url` VARCHAR(500) NULL,
    `cover_url` VARCHAR(500) NULL,
    `legal_name` VARCHAR(255) NOT NULL,
    `tax_id` VARCHAR(255) NOT NULL,
    `iban` VARCHAR(255) NOT NULL,
    `commission_rate` DECIMAL(5, 4) NOT NULL DEFAULT 0.1500,
    `rating_avg` DECIMAL(3, 2) NULL,
    `rating_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `status` ENUM('draft', 'active', 'paused', 'blocked') NOT NULL DEFAULT 'draft',
    `application_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `venues_slug_key`(`slug`),
    INDEX `venues_city_id_status_idx`(`city_id`, `status`),
    INDEX `venues_category_id_idx`(`category_id`),
    INDEX `venues_lat_lng_idx`(`lat`, `lng`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `venue_members` (
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `role` ENUM('owner', 'staff') NOT NULL,
    `status` ENUM('invited', 'active', 'disabled') NOT NULL DEFAULT 'active',
    `invited_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `venue_members_user_id_idx`(`user_id`),
    PRIMARY KEY (`venue_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `venue_hours` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `weekday` TINYINT NOT NULL,
    `opens_at` TIME(0) NOT NULL,
    `closes_at` TIME(0) NOT NULL,
    `is_closed` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `venue_hours_venue_id_weekday_key`(`venue_id`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `venue_closures` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `date` DATE NOT NULL,
    `reason` VARCHAR(255) NULL,

    UNIQUE INDEX `venue_closures_venue_id_date_key`(`venue_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `venue_photos` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,

    INDEX `venue_photos_venue_id_idx`(`venue_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `offers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `photo_url` VARCHAR(500) NULL,
    `original_price` DECIMAL(10, 2) NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `est_weight_kg` DECIMAL(5, 2) NOT NULL DEFAULT 0.50,
    `max_per_order` TINYINT UNSIGNED NOT NULL DEFAULT 2,
    `status` ENUM('active', 'paused', 'archived') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `offers_venue_id_status_idx`(`venue_id`, `status`),
    INDEX `offers_category_id_idx`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `offer_tags` (
    `offer_id` BIGINT UNSIGNED NOT NULL,
    `tag_id` BIGINT UNSIGNED NOT NULL,

    INDEX `offer_tags_tag_id_idx`(`tag_id`),
    PRIMARY KEY (`offer_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `offer_allergens` (
    `offer_id` BIGINT UNSIGNED NOT NULL,
    `allergen_id` BIGINT UNSIGNED NOT NULL,

    INDEX `offer_allergens_allergen_id_idx`(`allergen_id`),
    PRIMARY KEY (`offer_id`, `allergen_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `offer_schedules` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `offer_id` BIGINT UNSIGNED NOT NULL,
    `weekday` TINYINT NOT NULL,
    `pickup_start` TIME(0) NOT NULL,
    `pickup_end` TIME(0) NOT NULL,
    `quantity` SMALLINT UNSIGNED NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `offer_schedules_offer_id_weekday_key`(`offer_id`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `offer_listings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `offer_id` BIGINT UNSIGNED NOT NULL,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `pickup_date` DATE NOT NULL,
    `pickup_start` DATETIME(3) NOT NULL,
    `pickup_end` DATETIME(3) NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `original_price` DECIMAL(10, 2) NOT NULL,
    `quantity_total` SMALLINT UNSIGNED NOT NULL,
    `quantity_left` SMALLINT UNSIGNED NOT NULL,
    `status` ENUM('scheduled', 'on_sale', 'sold_out', 'closed', 'cancelled') NOT NULL,
    `source` ENUM('schedule', 'manual') NOT NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `offer_listings_status_pickup_end_idx`(`status`, `pickup_end`),
    INDEX `offer_listings_venue_id_pickup_date_idx`(`venue_id`, `pickup_date`),
    UNIQUE INDEX `offer_listings_offer_id_pickup_date_pickup_start_key`(`offer_id`, `pickup_date`, `pickup_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `orders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(26) NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `listing_id` BIGINT UNSIGNED NOT NULL,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `quantity` TINYINT UNSIGNED NOT NULL,
    `unit_price` DECIMAL(10, 2) NOT NULL,
    `unit_original_price` DECIMAL(10, 2) NOT NULL,
    `total_amount` DECIMAL(10, 2) NOT NULL,
    `saving_amount` DECIMAL(10, 2) NOT NULL,
    `commission_amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('pending_payment', 'paid', 'picked_up', 'cancelled_by_customer', 'cancelled_by_venue', 'expired', 'no_show', 'refunded') NOT NULL,
    `reserved_until` DATETIME(3) NOT NULL,
    `pickup_date` DATE NOT NULL,
    `pickup_start` DATETIME(3) NOT NULL,
    `pickup_end` DATETIME(3) NOT NULL,
    `voucher_code` CHAR(6) NULL,
    `voucher_token_hash` CHAR(64) NULL,
    `voucher_status` ENUM('active', 'used', 'expired') NULL,
    `voucher_valid_until` DATETIME(3) NULL,
    `picked_up_at` DATETIME(3) NULL,
    `picked_up_by` BIGINT UNSIGNED NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `source` ENUM('search', 'map', 'recommendation', 'favorite', 'direct') NULL,
    `idempotency_key` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_public_id_key`(`public_id`),
    UNIQUE INDEX `orders_voucher_token_hash_key`(`voucher_token_hash`),
    INDEX `orders_user_id_status_idx`(`user_id`, `status`),
    INDEX `orders_venue_id_pickup_date_status_idx`(`venue_id`, `pickup_date`, `status`),
    INDEX `orders_status_reserved_until_idx`(`status`, `reserved_until`),
    INDEX `orders_listing_id_idx`(`listing_id`),
    UNIQUE INDEX `orders_venue_id_pickup_date_voucher_code_key`(`venue_id`, `pickup_date`, `voucher_code`),
    UNIQUE INDEX `orders_user_id_idempotency_key_key`(`user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `order_status_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `from_status` ENUM('pending_payment', 'paid', 'picked_up', 'cancelled_by_customer', 'cancelled_by_venue', 'expired', 'no_show', 'refunded') NULL,
    `to_status` ENUM('pending_payment', 'paid', 'picked_up', 'cancelled_by_customer', 'cancelled_by_venue', 'expired', 'no_show', 'refunded') NOT NULL,
    `actor_type` ENUM('customer', 'venue', 'admin', 'system', 'payment_provider') NOT NULL,
    `actor_id` BIGINT UNSIGNED NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_status_history_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `payments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `provider` ENUM('liqpay', 'fake') NOT NULL,
    `provider_order_id` VARCHAR(64) NOT NULL,
    `provider_payment_id` VARCHAR(64) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` VARCHAR(30) NULL,
    `status` ENUM('created', 'processing', 'success', 'failure', 'reversed') NOT NULL DEFAULT 'created',
    `raw_callback` JSON NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_provider_order_id_key`(`provider_order_id`),
    UNIQUE INDEX `payments_provider_payment_id_key`(`provider_payment_id`),
    INDEX `payments_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `refunds` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `payment_id` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `initiated_by` ENUM('customer', 'venue', 'admin', 'system') NOT NULL,
    `initiator_id` BIGINT UNSIGNED NULL,
    `status` ENUM('pending', 'success', 'failure') NOT NULL DEFAULT 'pending',
    `provider_response` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `refunds_payment_id_idx`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `payment_webhook_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `provider` ENUM('liqpay', 'fake') NOT NULL,
    `signature_valid` BOOLEAN NOT NULL,
    `payload` JSON NOT NULL,
    `processed` BOOLEAN NOT NULL DEFAULT false,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_webhook_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `favorites` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `notify_new_listings` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `favorites_venue_id_idx`(`venue_id`),
    PRIMARY KEY (`user_id`, `venue_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `rating` TINYINT NOT NULL,
    `comment` VARCHAR(500) NULL,
    `is_hidden` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reviews_order_id_key`(`order_id`),
    INDEX `reviews_venue_id_created_at_idx`(`venue_id`, `created_at`),
    INDEX `reviews_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `interactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `anon_id` CHAR(26) NULL,
    `offer_id` BIGINT UNSIGNED NOT NULL,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('impression', 'view', 'favorite', 'reserve', 'purchase', 'pickup', 'review') NOT NULL,
    `source` ENUM('home', 'search', 'map', 'recommendation', 'venue', 'favorite', 'direct') NULL,
    `position` SMALLINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `interactions_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `interactions_offer_id_type_created_at_idx`(`offer_id`, `type`, `created_at`),
    INDEX `interactions_venue_id_idx`(`venue_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `user_stats` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `saved_count` INTEGER NOT NULL DEFAULT 0,
    `saved_kg` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `saved_money` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `co2_kg` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `level_id` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_stats_level_id_idx`(`level_id`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `user_achievements` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `achievement_id` BIGINT UNSIGNED NOT NULL,
    `earned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_achievements_achievement_id_idx`(`achievement_id`),
    PRIMARY KEY (`user_id`, `achievement_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `user_preferences` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `category_weights` JSON NOT NULL,
    `tag_weights` JSON NOT NULL,
    `price_band` JSON NULL,
    `preferred_hours` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `notification_settings` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `push_enabled` BOOLEAN NOT NULL DEFAULT true,
    `email_enabled` BOOLEAN NOT NULL DEFAULT true,
    `order_updates` BOOLEAN NOT NULL DEFAULT true,
    `pickup_reminders` BOOLEAN NOT NULL DEFAULT true,
    `favorites_new_listings` BOOLEAN NOT NULL DEFAULT true,
    `marketing` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `push_subscriptions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `push_subscriptions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `notifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `data` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `settlements` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `venue_id` BIGINT UNSIGNED NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `gross_amount` DECIMAL(10, 2) NOT NULL,
    `commission_amount` DECIMAL(10, 2) NOT NULL,
    `refunds_amount` DECIMAL(10, 2) NOT NULL,
    `payout_amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('pending', 'paid') NOT NULL DEFAULT 'pending',
    `paid_at` DATETIME(3) NULL,
    `paid_reference` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `settlements_venue_id_period_start_key`(`venue_id`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `settlement_items` (
    `settlement_id` BIGINT UNSIGNED NOT NULL,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `commission` DECIMAL(10, 2) NOT NULL,

    INDEX `settlement_items_order_id_idx`(`order_id`),
    PRIMARY KEY (`settlement_id`, `order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `audit_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `actor_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` BIGINT UNSIGNED NULL,
    `diff` JSON NULL,
    `ip` VARBINARY(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_log_actor_id_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `users` ADD CONSTRAINT `users_city_id_fkey` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `oauth_accounts` ADD CONSTRAINT `oauth_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `settings` ADD CONSTRAINT `settings_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `partner_applications` ADD CONSTRAINT `partner_applications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `partner_applications` ADD CONSTRAINT `partner_applications_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `venues` ADD CONSTRAINT `venues_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `venues` ADD CONSTRAINT `venues_city_id_fkey` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `venues` ADD CONSTRAINT `venues_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `partner_applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `venue_members` ADD CONSTRAINT `venue_members_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `venue_members` ADD CONSTRAINT `venue_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `venue_members` ADD CONSTRAINT `venue_members_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `venue_hours` ADD CONSTRAINT `venue_hours_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `venue_closures` ADD CONSTRAINT `venue_closures_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `venue_photos` ADD CONSTRAINT `venue_photos_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `offers` ADD CONSTRAINT `offers_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `offers` ADD CONSTRAINT `offers_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `offer_tags` ADD CONSTRAINT `offer_tags_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `offer_tags` ADD CONSTRAINT `offer_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `offer_allergens` ADD CONSTRAINT `offer_allergens_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `offer_allergens` ADD CONSTRAINT `offer_allergens_allergen_id_fkey` FOREIGN KEY (`allergen_id`) REFERENCES `allergens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `offer_schedules` ADD CONSTRAINT `offer_schedules_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `offer_listings` ADD CONSTRAINT `offer_listings_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `offer_listings` ADD CONSTRAINT `offer_listings_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orders` ADD CONSTRAINT `orders_listing_id_fkey` FOREIGN KEY (`listing_id`) REFERENCES `offer_listings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orders` ADD CONSTRAINT `orders_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orders` ADD CONSTRAINT `orders_picked_up_by_fkey` FOREIGN KEY (`picked_up_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `favorites` ADD CONSTRAINT `favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `favorites` ADD CONSTRAINT `favorites_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `reviews` ADD CONSTRAINT `reviews_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reviews` ADD CONSTRAINT `reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reviews` ADD CONSTRAINT `reviews_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `interactions` ADD CONSTRAINT `interactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `interactions` ADD CONSTRAINT `interactions_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `interactions` ADD CONSTRAINT `interactions_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `user_stats` ADD CONSTRAINT `user_stats_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_stats` ADD CONSTRAINT `user_stats_level_id_fkey` FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_achievement_id_fkey` FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_preferences` ADD CONSTRAINT `user_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notification_settings` ADD CONSTRAINT `notification_settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `settlements` ADD CONSTRAINT `settlements_venue_id_fkey` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `settlement_items` ADD CONSTRAINT `settlement_items_settlement_id_fkey` FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `settlement_items` ADD CONSTRAINT `settlement_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;



ALTER TABLE `offers`
    ADD CONSTRAINT `offers_price_chk` CHECK (`price` > 0 AND `price` < `original_price`),
    ADD CONSTRAINT `offers_max_per_order_chk` CHECK (`max_per_order` BETWEEN 1 AND 5),
    ADD CONSTRAINT `offers_est_weight_chk` CHECK (`est_weight_kg` > 0);

ALTER TABLE `offer_listings`
    ADD CONSTRAINT `offer_listings_qty_chk` CHECK (`quantity_left` <= `quantity_total`),
    ADD CONSTRAINT `offer_listings_window_chk` CHECK (`pickup_start` < `pickup_end`),
    ADD CONSTRAINT `offer_listings_price_chk` CHECK (`price` > 0 AND `price` < `original_price`);

ALTER TABLE `offer_schedules`
    ADD CONSTRAINT `offer_schedules_weekday_chk` CHECK (`weekday` BETWEEN 1 AND 7),
    ADD CONSTRAINT `offer_schedules_window_chk` CHECK (`pickup_start` < `pickup_end`);

ALTER TABLE `venue_hours`
    ADD CONSTRAINT `venue_hours_weekday_chk` CHECK (`weekday` BETWEEN 1 AND 7);

ALTER TABLE `orders`
    ADD CONSTRAINT `orders_quantity_chk` CHECK (`quantity` BETWEEN 1 AND 5);

ALTER TABLE `reviews`
    ADD CONSTRAINT `reviews_rating_chk` CHECK (`rating` BETWEEN 1 AND 5);

ALTER TABLE `venues`
    ADD CONSTRAINT `venues_lat_chk` CHECK (`lat` BETWEEN -90 AND 90),
    ADD CONSTRAINT `venues_lng_chk` CHECK (`lng` BETWEEN -180 AND 180);
