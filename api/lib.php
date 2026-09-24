<?php
/*
 * Общие функции API витрины: конфиг, PDO, JSON-ответы, сессия, CSRF, сборка/сохранение данных.
 * Подключается из api/*.php; напрямую не вызывается (закрыто в .htaccess).
 */
declare(strict_types=1);

const ROOT = __DIR__ . '/..';

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = getenv('TORSHER_CONFIG') ?: __DIR__ . '/config.php';
        if (!is_file($file)) {
            json_error(503, 'Сервер не настроен: скопируйте api/config.sample.php в api/config.php');
        }
        $cfg = require $file;
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        try {
            $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['password'] ?? null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            error_log('torsher db: ' . $e->getMessage());
            json_error(503, 'Нет подключения к базе данных');
        }
    }
    return $pdo;
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(int $status, string $message): void
{
    json_out(['error' => $message], $status);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) json_error(400, 'Ожидается JSON');
    // Та же структура, но объекты остаются объектами: нужна, чтобы пустые {} не превратились в [].
    $GLOBALS['json_body_objects'] = json_decode($raw);
    return $data;
}

/* JSON-кодирование с сохранением пустых объектов {} (json_decode(..., true) превращает их в []). */
function enc_json($v): string
{
    return json_encode($v ?? new stdClass(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/* ---------- Сессия и авторизация ---------- */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_name('torsher_admin');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function current_user(): ?array
{
    start_session();
    return isset($_SESSION['user_id']) ? ['id' => $_SESSION['user_id'], 'login' => $_SESSION['login']] : null;
}

/* Для изменяющих запросов: нужен вход и совпадающий CSRF-токен из заголовка X-CSRF-Token. */
function require_admin(): array
{
    $user = current_user();
    if (!$user) json_error(401, 'Требуется вход');
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!hash_equals($_SESSION['csrf'], $token)) json_error(403, 'Неверный CSRF-токен');
    return $user;
}

/* ---------- Данные витрины: таблицы ↔ JSON для плеера и админки ---------- */

function num_or_str(?string $v)
{
    if ($v === null || $v === '') return $v === '' ? '' : null;
    return is_numeric($v) ? $v + 0 : $v;
}

function load_data(): array
{
    $pdo = db();
    $site = $pdo->query('SELECT cafe, settings, ticker, version, updated_at FROM site WHERE id = 1')->fetch();
    if (!$site) json_error(503, 'База не инициализирована: откройте api/install.php');

    $dishes = array_map(fn($r) => [
        'id' => $r['id'], 'name' => $r['name'], 'category' => $r['category'], 'description' => (string)$r['description'],
        'weight' => $r['weight'], 'price' => num_or_str($r['price']), 'oldPrice' => num_or_str($r['old_price']),
        'tag' => $r['tag'], 'photo' => $r['photo'], 'active' => (bool)$r['active'],
    ], $pdo->query('SELECT * FROM dishes ORDER BY position, name')->fetchAll());

    $events = array_map(fn($r) => [
        'id' => $r['id'], 'title' => $r['title'], 'date' => $r['event_date'], 'time' => $r['time_start'], 'endTime' => $r['time_end'],
        'description' => (string)$r['description'], 'price' => $r['price'], 'tag' => $r['tag'], 'photo' => $r['photo'],
        'highlight' => (bool)$r['highlight'], 'active' => (bool)$r['active'],
    ], $pdo->query('SELECT * FROM events ORDER BY event_date, time_start')->fetchAll());

    $slides = array_map(function ($r) {
        $s = (array)(json_decode($r['config']) ?: new stdClass());
        return (object)array_merge($s, ['id' => $r['id'], 'type' => $r['type'], 'enabled' => (bool)$r['enabled']]);
    }, $pdo->query('SELECT * FROM slides ORDER BY position')->fetchAll());

    return [
        'version' => 2,
        'revision' => (int)$site['version'],
        'updatedAt' => $site['updated_at'],
        'cafe' => json_decode($site['cafe']) ?: new stdClass(),
        'settings' => json_decode($site['settings']) ?: new stdClass(),
        'ticker' => json_decode($site['ticker'], true) ?: [],
        'dishes' => $dishes,
        'events' => $events,
        'slides' => $slides,
    ];
}

function str_field(array $a, string $k, int $max = 255): string
{
    $v = $a[$k] ?? '';
    if (!is_scalar($v)) $v = '';
    return mb_substr(trim((string)$v), 0, $max);
}

function nullable_price($v): ?string
{
    if ($v === null || $v === '' || !is_scalar($v)) return null;
    return mb_substr((string)$v, 0, 32);
}

/* Полная замена данных в одной транзакции: админка всегда присылает целиком весь набор. */
function save_data(array $d, $objects = null): int
{
    $objects = $objects ?? ($GLOBALS['json_body_objects'] ?? null);
    $obj = fn(string $k) => is_object($objects) && isset($objects->$k) ? $objects->$k : ($d[$k] ?? new stdClass());
    foreach (['dishes', 'events', 'slides'] as $k) {
        if (!isset($d[$k]) || !is_array($d[$k])) json_error(422, "Нет раздела $k");
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE site SET cafe = ?, settings = ?, ticker = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1')
            ->execute([enc_json($obj('cafe')), enc_json($obj('settings')), enc_json(array_values($d['ticker'] ?? []))]);
        $slideObjects = is_array($obj('slides')) ? array_values($obj('slides')) : [];

        $pdo->exec('DELETE FROM dishes');
        $ins = $pdo->prepare('INSERT INTO dishes (id, position, name, category, description, weight, price, old_price, tag, photo, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        foreach (array_values($d['dishes']) as $i => $x) {
            if (!is_array($x) || str_field($x, 'id', 64) === '') continue;
            $ins->execute([str_field($x, 'id', 64), $i, str_field($x, 'name'), str_field($x, 'category', 128), str_field($x, 'description', 2000),
                str_field($x, 'weight', 64), nullable_price($x['price'] ?? '') ?? '', nullable_price($x['oldPrice'] ?? null),
                str_field($x, 'tag', 64), ($x['photo'] ?? null) ? str_field($x, 'photo') : null, ($x['active'] ?? true) !== false ? 1 : 0]);
        }

        $pdo->exec('DELETE FROM events');
        $ins = $pdo->prepare('INSERT INTO events (id, event_date, time_start, time_end, title, description, price, tag, photo, highlight, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        foreach ($d['events'] as $x) {
            if (!is_array($x) || str_field($x, 'id', 64) === '') continue;
            $date = str_field($x, 'date', 10);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) continue;
            $ins->execute([str_field($x, 'id', 64), $date, str_field($x, 'time', 5), str_field($x, 'endTime', 5), str_field($x, 'title'),
                str_field($x, 'description', 2000), str_field($x, 'price', 128), str_field($x, 'tag', 64),
                ($x['photo'] ?? null) ? str_field($x, 'photo') : null, !empty($x['highlight']) ? 1 : 0, ($x['active'] ?? true) !== false ? 1 : 0]);
        }

        $pdo->exec('DELETE FROM slides');
        $ins = $pdo->prepare('INSERT INTO slides (id, position, type, enabled, config) VALUES (?,?,?,?,?)');
        foreach (array_values($d['slides']) as $i => $x) {
            if (!is_array($x) || str_field($x, 'id', 64) === '') continue;
            $type = in_array($x['type'] ?? '', ['dishes', 'events', 'info'], true) ? $x['type'] : 'dishes';
            $cfg = isset($slideObjects[$i]) && is_object($slideObjects[$i]) ? clone $slideObjects[$i] : (object)$x;
            unset($cfg->id, $cfg->type, $cfg->enabled);
            $ins->execute([str_field($x, 'id', 64), $i, $type, ($x['enabled'] ?? true) !== false ? 1 : 0, enc_json($cfg)]);
        }

        $rev = (int)$pdo->query('SELECT version FROM site WHERE id = 1')->fetchColumn();
        $pdo->commit();
        return $rev;
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('torsher save: ' . $e->getMessage());
        json_error(500, 'Не удалось сохранить данные');
    }
}

/* ---------- Настройки сервера (таблица options) и секреты ---------- */

function option_get(string $name, $default = null)
{
    db()->exec('CREATE TABLE IF NOT EXISTS options (name VARCHAR(64) NOT NULL PRIMARY KEY, value TEXT NOT NULL)');
    $st = db()->prepare('SELECT value FROM options WHERE name = ?');
    $st->execute([$name]);
    $v = $st->fetchColumn();
    return $v === false ? $default : json_decode($v, true);
}

function option_set(string $name, $value): void
{
    $pdo = db();
    $pdo->exec('CREATE TABLE IF NOT EXISTS options (name VARCHAR(64) NOT NULL PRIMARY KEY, value TEXT NOT NULL)');
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM options WHERE name = ?')->execute([$name]);
    $pdo->prepare('INSERT INTO options (name, value) VALUES (?, ?)')->execute([$name, enc_json($value)]);
    $pdo->commit();
}

/* Шифрование секретов ключом app_key из config.php (libsodium). Без ключа хранится как есть. */
function secret_key(): ?string
{
    $k = (string)(config()['app_key'] ?? '');
    return strlen($k) >= 16 ? sodium_crypto_generichash($k, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES) : null;
}

function secret_encrypt(string $plain): string
{
    $key = secret_key();
    if (!$key || $plain === '') return $plain === '' ? '' : 'plain:' . base64_encode($plain);
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return 'sbox:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
}

function secret_decrypt(string $stored): string
{
    if (str_starts_with($stored, 'plain:')) return (string)base64_decode(substr($stored, 6));
    if (!str_starts_with($stored, 'sbox:')) return '';
    $key = secret_key();
    if (!$key) throw new RuntimeException('Пароль зашифрован, но app_key в config.php не задан или изменён');
    $raw = base64_decode(substr($stored, 5));
    $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $key);
    if ($plain === false) throw new RuntimeException('Не удалось расшифровать пароль: app_key изменился — введите пароль заново');
    return $plain;
}
