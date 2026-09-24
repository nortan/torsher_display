<?php
/*
 * Слой хранения: данные витрины, пользователи, настройки сервера и реестр фото
 * хранятся либо в базе данных (MySQL), либо в файловой структуре (JSON в папке data/).
 *
 * Режим: data/storage.json {"mode": "db"|"files"} (его пишет переключатель в админке),
 * иначе config.php 'storage' (по умолчанию 'db').
 * Подключается из lib.php.
 */
declare(strict_types=1);

const STORAGE_MODES = ['db', 'files'];

/* ---------- Режим и папка данных ---------- */

function data_dir(): string
{
    $d = (string)(config()['data_dir'] ?? 'data');
    return $d !== '' && ($d[0] === '/' || preg_match('~^[A-Za-z]:[\\\\/]~', $d)) ? rtrim($d, '/') : ROOT . '/' . trim($d, '/');
}

function storage_mode(): string
{
    static $mode = null;
    if (!empty($GLOBALS['storage_mode_override'])) return $GLOBALS['storage_mode_override']; // на время переноса
    if ($mode !== null) return $mode;
    $f = data_dir() . '/storage.json';
    $m = is_file($f) ? (json_decode((string)file_get_contents($f), true)['mode'] ?? null) : null;
    if (!in_array($m, STORAGE_MODES, true)) $m = config()['storage'] ?? 'db';
    return $mode = in_array($m, STORAGE_MODES, true) ? $m : 'db';
}

function storage_set_mode(string $mode): void
{
    files_write('storage', ['mode' => $mode, 'changedAt' => date('c')]);
}

/* ---------- Файловое хранилище: атомарная запись JSON с блокировкой ---------- */

function files_ensure_dir(): void
{
    $dir = data_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) throw new RuntimeException('Нет прав на создание папки ' . $dir);
    if (!is_writable($dir)) throw new RuntimeException('Нет прав на запись в папку ' . $dir);
    // закрываем папку от чтения через веб (Apache); для nginx — см. docs/nginx.conf.example
    if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\n");
}

function files_read(string $name, $default = null, bool $assoc = true)
{
    $f = data_dir() . '/' . $name . '.json';
    if (!is_file($f)) return $default;
    $h = fopen($f, 'r');
    flock($h, LOCK_SH);
    $raw = stream_get_contents($h);
    flock($h, LOCK_UN);
    fclose($h);
    $v = json_decode((string)$raw, $assoc);
    return $v === null ? $default : $v;
}

function files_write(string $name, $value): void
{
    files_ensure_dir();
    $f = data_dir() . '/' . $name . '.json';
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false || file_put_contents($tmp, $json . "\n", LOCK_EX) === false) throw new RuntimeException('Не удалось записать ' . $f);
    @chmod($tmp, 0664);
    if (!rename($tmp, $f)) { @unlink($tmp); throw new RuntimeException('Не удалось сохранить ' . $f); }
}

/* ---------- Нормализация записей (одинаково для обоих хранилищ) ---------- */

const DISH_COLUMNS = ['id', 'name', 'category', 'description', 'weight', 'price', 'oldPrice', 'tag', 'photo', 'active'];
const EVENT_COLUMNS = ['id', 'title', 'date', 'time', 'endTime', 'description', 'price', 'tag', 'photo', 'highlight', 'active'];
const SLIDE_TYPES = ['dishes', 'events', 'info', 'announce', 'countdown'];

/* Поля, которых нет среди колонок (accent, isNew и будущие), — в JSON extra. */
function extra_fields(array $x, array $columns): array
{
    $out = [];
    foreach ($x as $k => $v) {
        if (!in_array($k, $columns, true) && (is_scalar($v) || is_array($v) || $v === null)) $out[$k] = $v;
    }
    return $out;
}

function norm_dish(array $x): ?array
{
    if (str_field($x, 'id', 64) === '') return null;
    return array_merge(extra_fields($x, DISH_COLUMNS), [
        'id' => str_field($x, 'id', 64), 'name' => str_field($x, 'name'), 'category' => str_field($x, 'category', 128),
        'description' => str_field($x, 'description', 2000), 'weight' => str_field($x, 'weight', 64),
        'price' => num_or_str(nullable_price($x['price'] ?? '') ?? ''), 'oldPrice' => num_or_str(nullable_price($x['oldPrice'] ?? null)),
        'tag' => str_field($x, 'tag', 64), 'photo' => ($x['photo'] ?? null) ? str_field($x, 'photo') : null,
        'active' => ($x['active'] ?? true) !== false,
    ]);
}

function norm_event(array $x): ?array
{
    $date = str_field($x, 'date', 10);
    if (str_field($x, 'id', 64) === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return null;
    return array_merge(extra_fields($x, EVENT_COLUMNS), [
        'id' => str_field($x, 'id', 64), 'title' => str_field($x, 'title'), 'date' => $date,
        'time' => str_field($x, 'time', 5), 'endTime' => str_field($x, 'endTime', 5),
        'description' => str_field($x, 'description', 2000), 'price' => str_field($x, 'price', 128), 'tag' => str_field($x, 'tag', 64),
        'photo' => ($x['photo'] ?? null) ? str_field($x, 'photo') : null,
        'highlight' => !empty($x['highlight']), 'active' => ($x['active'] ?? true) !== false,
    ]);
}

/* ---------- Единый интерфейс ---------- */

function load_data(): array
{
    return storage_mode() === 'files' ? files_load_data() : db_load_data();
}

function save_data(array $d, $objects = null): int
{
    foreach (['dishes', 'events', 'slides'] as $k) {
        if (!isset($d[$k]) || !is_array($d[$k])) json_error(422, "Нет раздела $k");
    }
    return storage_mode() === 'files' ? files_save_data($d, $objects) : db_save_data($d, $objects);
}

function current_revision(): int
{
    if (storage_mode() === 'files') return (int)(files_read('site', [])['revision'] ?? 0);
    return (int)db()->query('SELECT version FROM site WHERE id = 1')->fetchColumn();
}

function user_find(string $login): ?array
{
    if (storage_mode() === 'files') {
        foreach (files_read('users', []) as $u) if ($u['login'] === $login) return $u;
        return null;
    }
    $st = db()->prepare('SELECT id, login, password_hash FROM users WHERE login = ?');
    $st->execute([$login]);
    return $st->fetch() ?: null;
}

function user_by_id(int $id): ?array
{
    if (storage_mode() === 'files') {
        foreach (files_read('users', []) as $u) if ((int)$u['id'] === $id) return $u;
        return null;
    }
    $st = db()->prepare('SELECT id, login, password_hash FROM users WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function user_set_password(int $id, string $hash): void
{
    if (storage_mode() === 'files') {
        $users = files_read('users', []);
        foreach ($users as &$u) if ((int)$u['id'] === $id) $u['password_hash'] = $hash;
        files_write('users', $users);
        return;
    }
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $id]);
}

function user_create(string $login, string $hash): void
{
    if (storage_mode() === 'files') {
        $users = files_read('users', []);
        $id = 1 + array_reduce($users, fn($m, $u) => max($m, (int)$u['id']), 0);
        $users[] = ['id' => $id, 'login' => $login, 'password_hash' => $hash, 'created_at' => date('Y-m-d H:i:s')];
        files_write('users', $users);
        return;
    }
    db()->prepare('INSERT INTO users (login, password_hash) VALUES (?, ?)')->execute([$login, $hash]);
}

function users_all(): array
{
    if (storage_mode() === 'files') return files_read('users', []);
    return db()->query('SELECT id, login, password_hash, created_at FROM users ORDER BY id')->fetchAll();
}

function option_get(string $name, $default = null)
{
    if (storage_mode() === 'files') {
        $all = files_read('options', []);
        return array_key_exists($name, $all) ? $all[$name] : $default;
    }
    return db_option_get($name, $default);
}

function option_set(string $name, $value): void
{
    if (storage_mode() === 'files') {
        $all = files_read('options', []);
        $all[$name] = $value;
        files_write('options', $all);
        return;
    }
    db_option_set($name, $value);
}

function options_all(): array
{
    if (storage_mode() === 'files') return files_read('options', []);
    ensure_db_schema();
    $out = [];
    foreach (db()->query('SELECT name, value FROM options')->fetchAll() as $r) $out[$r['name']] = json_decode($r['value'], true);
    return $out;
}

function media_add(array $m): void
{
    if (storage_mode() === 'files') {
        $all = files_read('media', []);
        $all[] = $m + ['created_at' => date('Y-m-d H:i:s')];
        files_write('media', $all);
        return;
    }
    db()->prepare('INSERT INTO media (path, original_name, mime, width, height, size, has_alpha) VALUES (?,?,?,?,?,?,?)')
        ->execute([$m['path'], $m['original_name'], $m['mime'], $m['width'], $m['height'], $m['size'], $m['has_alpha'] ? 1 : 0]);
}

function media_all(): array
{
    if (storage_mode() === 'files') return files_read('media', []);
    return db()->query('SELECT path, original_name, mime, width, height, size, has_alpha, created_at FROM media ORDER BY id')->fetchAll();
}

/* ---------- Файловое хранилище: данные витрины ---------- */

function files_load_data(): array
{
    $doc = files_read('site', null, false);
    if (!$doc) json_error(503, 'Данные не инициализированы: откройте api/install.php');
    return (array)$doc;
}

function files_save_data(array $d, $objects = null): int
{
    $objects = $objects ?? ($GLOBALS['json_body_objects'] ?? null);
    $obj = fn(string $k) => is_object($objects) && isset($objects->$k) ? $objects->$k : (object)($d[$k] ?? []);
    $prev = files_read('site', []);
    // номер ревизии только растёт — в том числе после переноса из БД ($d['revision'] — ревизия источника)
    $rev = max((int)($prev['revision'] ?? 0), (int)($d['revision'] ?? 0)) + 1;

    $slideObjects = is_object($objects) && isset($objects->slides) && is_array($objects->slides) ? array_values($objects->slides) : [];
    $slides = [];
    foreach (array_values($d['slides']) as $i => $x) {
        if (!is_array($x) || str_field($x, 'id', 64) === '') continue;
        $s = isset($slideObjects[$i]) && is_object($slideObjects[$i]) ? clone $slideObjects[$i] : (object)$x;
        $s->id = str_field($x, 'id', 64);
        $s->type = in_array($x['type'] ?? '', SLIDE_TYPES, true) ? $x['type'] : 'dishes';
        $s->enabled = ($x['enabled'] ?? true) !== false;
        $slides[] = $s;
    }
    files_write('site', [
        'version' => 2,
        'revision' => $rev,
        'updatedAt' => date('Y-m-d H:i:s'),
        'cafe' => $obj('cafe'),
        'settings' => $obj('settings'),
        'ticker' => array_values(array_filter($d['ticker'] ?? [], 'is_string')),
        'dishes' => array_values(array_filter(array_map(fn($x) => is_array($x) ? norm_dish($x) : null, $d['dishes']))),
        'events' => array_values(array_filter(array_map(fn($x) => is_array($x) ? norm_event($x) : null, $d['events']))),
        'slides' => $slides,
    ]);
    return $rev;
}

/* ---------- Состояние и переключение ---------- */

function db_try(): ?string
{
    try {
        $c = config()['db'] ?? [];
        if (empty($c['dsn'])) return 'В config.php не задано подключение к базе';
        $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['password'] ?? null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->query('SELECT 1');
        return null;
    } catch (Throwable $e) {
        return 'Нет подключения к базе данных';
    }
}

function files_try(): ?string
{
    try { files_ensure_dir(); return null; } catch (Throwable $e) { return $e->getMessage(); }
}

/* Переносит всё содержимое текущего хранилища в целевое и переключает режим. */
function storage_switch(string $target): array
{
    if (!in_array($target, STORAGE_MODES, true)) throw new RuntimeException('Неизвестный режим хранения');
    $from = storage_mode();
    if ($from === $target) throw new RuntimeException('Этот режим уже включён');
    $err = $target === 'db' ? db_try() : files_try();
    if ($err) throw new RuntimeException($err);

    // снимок из текущего хранилища (объекты сохраняем объектами: пустые {} не должны стать [])
    $raw = json_encode(load_data(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $data = json_decode($raw, true);
    $objects = json_decode($raw);
    $users = users_all();
    $options = options_all();
    $media = media_all();

    // запись в целевое хранилище
    storage_force_mode($target);
    if ($target === 'db') {
        ensure_db_schema();
        $pdo = db();
        $srcRev = (int)($data['revision'] ?? 0);
        if (!(int)$pdo->query('SELECT COUNT(*) FROM site')->fetchColumn()) {
            $pdo->exec("INSERT INTO site (id, cafe, settings, ticker, version) VALUES (1, '{}', '{}', '[]', $srcRev)");
        } else {
            $pdo->exec("UPDATE site SET version = $srcRev WHERE id = 1 AND version < $srcRev");  // ревизия только растёт
        }
        db_save_data($data, $objects);
        $pdo->exec('DELETE FROM users');
        foreach ($users as $u) $pdo->prepare('INSERT INTO users (id, login, password_hash) VALUES (?, ?, ?)')->execute([(int)$u['id'], $u['login'], $u['password_hash']]);
        foreach ($options as $k => $v) db_option_set($k, $v);
        $pdo->exec('DELETE FROM media');
        foreach ($media as $m) media_add($m + ['has_alpha' => !empty($m['has_alpha'])]);
    } else {
        files_save_data($data, $objects);
        files_write('users', array_map(fn($u) => ['id' => (int)$u['id'], 'login' => $u['login'], 'password_hash' => $u['password_hash'], 'created_at' => $u['created_at'] ?? date('Y-m-d H:i:s')], $users));
        files_write('options', (object)$options);
        files_write('media', array_values($media));
    }
    storage_set_mode($target);
    return ['from' => $from, 'to' => $target, 'dishes' => count($data['dishes']), 'events' => count($data['events']),
        'slides' => count($data['slides']), 'users' => count($users)];
}

/* Внутренний: сменить режим на время текущего запроса (перенос данных). */
function storage_force_mode(string $mode): void
{
    $GLOBALS['storage_mode_override'] = $mode;
}
