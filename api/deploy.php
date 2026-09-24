<?php
/*
 * Выгрузка статической сборки витрины на удалённый сервер по FTP / FTPS.
 *
 * GET  api/deploy.php                      — настройки FTP (пароль не возвращается)
 * POST api/deploy.php {action:"save", host, port, user, password?, dir, ftps, passive}
 * POST api/deploy.php {action:"test"}      — проверить подключение и папку
 * POST api/deploy.php {action:"upload"}    — собрать и выгрузить сборку
 *
 * Сборка = файлы плеера (build-files.json) + фото, на которые ссылаются данные,
 * + content/data.json и content/data.js (из MySQL) + build.json с номером версии.
 * Неизменившиеся файлы (совпал размер) пропускаются; данные и build.json выгружаются последними.
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

const FTP_OPTION = 'deploy_ftp';

function ftp_settings(): array
{
    return array_merge(['host' => '', 'port' => 21, 'user' => '', 'password' => '', 'dir' => '/', 'ftps' => false, 'passive' => true,
        'lastUpload' => null], option_get(FTP_OPTION, []) ?: []);
}

function public_settings(array $s): array
{
    $out = $s;
    $out['hasPassword'] = $s['password'] !== '';
    $out['encrypted'] = secret_key() !== null;
    unset($out['password']);
    return $out;
}

/** @return resource|\FTP\Connection */
function ftp_open(array $s, array &$log)
{
    if ($s['host'] === '') throw new RuntimeException('Не указан адрес FTP-сервера');
    $port = (int)$s['port'] ?: 21;
    if (!empty($s['ftps'])) {
        if (!function_exists('ftp_ssl_connect')) throw new RuntimeException('PHP собран без поддержки FTPS');
        $conn = @ftp_ssl_connect($s['host'], $port, 20);
    } else {
        $conn = @ftp_connect($s['host'], $port, 20);
    }
    if (!$conn) throw new RuntimeException("Не удалось подключиться к {$s['host']}:$port");
    if (!@ftp_login($conn, $s['user'], secret_decrypt((string)$s['password']))) {
        ftp_close($conn);
        throw new RuntimeException('FTP-сервер отклонил логин или пароль');
    }
    ftp_pasv($conn, !empty($s['passive']));
    $log[] = "Подключено к {$s['host']}:$port" . (!empty($s['ftps']) ? ' (FTPS)' : '') . " как {$s['user']}";
    return $conn;
}

function remote_dir(array $s): string
{
    $d = '/' . trim(str_replace('\\', '/', (string)$s['dir']), '/');
    return $d === '/' ? '' : $d;
}

function ftp_mkdirs($conn, string $dir, array &$made): void
{
    if ($dir === '' || isset($made[$dir])) return;
    $parts = explode('/', trim($dir, '/'));
    $path = '';
    foreach ($parts as $p) {
        $path .= '/' . $p;
        if (isset($made[$path])) continue;
        if (!@ftp_chdir($conn, $path)) {
            if (!@ftp_mkdir($conn, $path)) throw new RuntimeException("Не удалось создать папку $path");
        }
        $made[$path] = true;
    }
}

/* Список файлов сборки: [удалённый путь => ['file' => локальный путь] | ['data' => содержимое]] */
function build_files(array $data, array &$log): array
{
    $files = [];
    $list = json_decode((string)@file_get_contents(ROOT . '/build-files.json'), true);
    if (!is_array($list)) throw new RuntimeException('Нет build-files.json: выполните node tools/build.mjs --manifest');
    foreach ($list as $rel) {
        if (!is_file(ROOT . '/' . $rel)) throw new RuntimeException("В сборке нет файла $rel");
        $files[$rel] = ['file' => ROOT . '/' . $rel];
    }
    $photos = [];
    foreach (array_merge($data['dishes'], $data['events']) as $o) if (!empty($o['photo'])) $photos[] = $o['photo'];
    if (!empty($data['cafe']['logo'])) $photos[] = $data['cafe']['logo'];
    foreach (array_unique($photos) as $p) {
        if (preg_match('~^(https?:|data:)~', $p) || str_contains($p, '..')) continue;
        if (is_file(ROOT . '/' . $p)) $files[$p] = ['file' => ROOT . '/' . $p];
        else $log[] = "⚠ нет файла фото: $p";
    }
    foreach (['SERVER.md', 'nginx.conf.example'] as $doc) {
        if (is_file(ROOT . '/docs/' . $doc)) $files[$doc] = ['file' => ROOT . '/docs/' . $doc];
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    // данные и версия — в самом конце
    $files['content/data.json'] = ['data' => $json . "\n"];
    $files['content/data.js'] = ['data' => 'window.__TORSHER_DATA__ = ' . $json . ";\n"];
    $files['build.json'] = ['data' => json_encode(['commit' => 'ftp-r' . $data['revision'] . '-' . date('YmdHis'), 'builtAt' => date('c')]) . "\n"];
    return $files;
}

function upload_build(array $s): array
{
    @set_time_limit(0);
    $log = [];
    $data = json_decode(json_encode(load_data()), true);
    $files = build_files($data, $log);
    $conn = ftp_open($s, $log);
    $base = remote_dir($s);
    $made = [];
    $sent = 0; $skipped = 0; $bytes = 0;
    try {
        foreach ($files as $rel => $src) {
            $remote = $base . '/' . $rel;
            ftp_mkdirs($conn, dirname($remote) === '/' ? '' : dirname($remote), $made);
            if (isset($src['file'])) {
                $size = filesize($src['file']);
                // статика (шрифты, библиотеки, фото) обычно не меняется: совпал размер — пропускаем
                if (!str_starts_with($rel, 'content/') && $rel !== 'build.json' && @ftp_size($conn, $remote) === $size) { $skipped++; continue; }
                $ok = @ftp_put($conn, $remote, $src['file'], FTP_BINARY);
            } else {
                $size = strlen($src['data']);
                $tmp = fopen('php://temp', 'r+');
                fwrite($tmp, $src['data']);
                rewind($tmp);
                $ok = @ftp_fput($conn, $remote, $tmp, FTP_BINARY);
                fclose($tmp);
            }
            if (!$ok) throw new RuntimeException("Не удалось выгрузить $remote");
            $sent++; $bytes += $size;
        }
    } finally {
        ftp_close($conn);
    }
    $log[] = sprintf('Выгружено файлов: %d (%.1f МБ), без изменений: %d. Папка: %s', $sent, $bytes / 1048576, $skipped, $base ?: '/');
    return ['log' => $log, 'sent' => $sent, 'skipped' => $skipped, 'revision' => $data['revision']];
}

/* ---------- Роутинг ---------- */

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!current_user()) json_error(401, 'Требуется вход');
    json_out(public_settings(ftp_settings()));
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error(405, 'Метод не поддерживается');

require_admin();
$body = read_json_body();
$s = ftp_settings();

try {
    switch ($body['action'] ?? '') {
        case 'save':
            $s['host'] = preg_replace('~^s?ftps?://~i', '', trim((string)($body['host'] ?? '')));
            $s['port'] = max(1, min(65535, (int)($body['port'] ?? 21)));
            $s['user'] = trim((string)($body['user'] ?? ''));
            $s['dir'] = trim((string)($body['dir'] ?? '/')) ?: '/';
            $s['ftps'] = !empty($body['ftps']);
            $s['passive'] = ($body['passive'] ?? true) !== false;
            if (isset($body['password']) && $body['password'] !== '') $s['password'] = secret_encrypt((string)$body['password']);
            if (!empty($body['clearPassword'])) $s['password'] = '';
            option_set(FTP_OPTION, $s);
            json_out(['ok' => true, 'settings' => public_settings($s)]);

        case 'test':
            $log = [];
            $conn = ftp_open($s, $log);
            $dir = remote_dir($s);
            $exists = $dir === '' || @ftp_chdir($conn, $dir);
            $log[] = $exists ? 'Папка ' . ($dir ?: '/') . ' доступна' : 'Папки ' . $dir . ' пока нет — она будет создана при выгрузке';
            ftp_close($conn);
            json_out(['ok' => true, 'log' => $log]);

        case 'upload':
            $res = upload_build($s);
            $s['lastUpload'] = ['at' => date('c'), 'revision' => $res['revision'], 'sent' => $res['sent'], 'skipped' => $res['skipped']];
            option_set(FTP_OPTION, $s);
            json_out(['ok' => true] + $res + ['settings' => public_settings($s)]);
    }
} catch (Throwable $e) {
    json_error(502, $e->getMessage());
}
json_error(400, 'Неизвестное действие');
