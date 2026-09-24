-- Схема БД витрины (MySQL 5.7+ / MariaDB 10.3+). Создаётся автоматически api/install.php,
-- но её можно применить и вручную: mysql -u user -p dbname < sql/schema.mysql.sql

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login         VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Одна строка: заведение, общие настройки, бегущая строка (JSON) и номер версии данных.
CREATE TABLE IF NOT EXISTS site (
  id         TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  cafe       TEXT     NOT NULL,
  settings   TEXT     NOT NULL,
  ticker     TEXT     NOT NULL,
  version    INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dishes (
  id          VARCHAR(64)   NOT NULL PRIMARY KEY,
  position    INT           NOT NULL DEFAULT 0,
  name        VARCHAR(255)  NOT NULL,
  category    VARCHAR(128)  NOT NULL DEFAULT '',
  description TEXT          NULL,
  weight      VARCHAR(64)   NOT NULL DEFAULT '',
  price       VARCHAR(32)   NOT NULL DEFAULT '',
  old_price   VARCHAR(32)   NULL,
  tag         VARCHAR(64)   NOT NULL DEFAULT '',
  photo       VARCHAR(255)  NULL,
  active      TINYINT(1)    NOT NULL DEFAULT 1,
  KEY idx_dishes_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  event_date  DATE         NOT NULL,
  time_start  VARCHAR(5)   NOT NULL DEFAULT '',
  time_end    VARCHAR(5)   NOT NULL DEFAULT '',
  title       VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  price       VARCHAR(128) NOT NULL DEFAULT '',
  tag         VARCHAR(64)  NOT NULL DEFAULT '',
  photo       VARCHAR(255) NULL,
  highlight   TINYINT(1)   NOT NULL DEFAULT 0,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  KEY idx_events_date (event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Слайды: тип и порядок — колонками, остальные настройки (раскладка, блюда, анимация,
-- положение фото, расписание показа…) — JSON в config.
CREATE TABLE IF NOT EXISTS slides (
  id       VARCHAR(64) NOT NULL PRIMARY KEY,
  position INT         NOT NULL DEFAULT 0,
  type     VARCHAR(16) NOT NULL,
  enabled  TINYINT(1)  NOT NULL DEFAULT 1,
  config   MEDIUMTEXT  NOT NULL,
  KEY idx_slides_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Загруженные фото (файлы лежат в uploads/).
CREATE TABLE IF NOT EXISTS media (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  path          VARCHAR(255) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL DEFAULT '',
  mime          VARCHAR(64)  NOT NULL,
  width         INT UNSIGNED NOT NULL DEFAULT 0,
  height        INT UNSIGNED NOT NULL DEFAULT 0,
  size          INT UNSIGNED NOT NULL DEFAULT 0,
  has_alpha     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Прочие настройки сервера (например, параметры выгрузки по FTP; пароль хранится зашифрованным).
CREATE TABLE IF NOT EXISTS options (
  name  VARCHAR(64) NOT NULL PRIMARY KEY,
  value TEXT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
