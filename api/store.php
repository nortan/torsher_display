<?php
/*
 * Хранение данных: в базе (MySQL) или в файлах (папка data/).
 *
 * GET  api/store.php                           — текущий режим и доступность обоих хранилищ
 * POST api/store.php {action:"switch", mode}   — перенести все данные в выбранное хранилище и переключиться
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!current_user()) json_error(401, 'Требуется вход');
    $files = data_dir();
    json_out([
        'mode' => storage_mode(),
        'db' => ['ok' => db_try() === null, 'error' => db_try()],
        'files' => ['ok' => files_try() === null, 'error' => files_try(), 'dir' => str_starts_with($files, ROOT . '/') ? substr($files, strlen(ROOT) + 1) : $files],
        'revision' => current_revision(),
    ]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error(405, 'Метод не поддерживается');

require_admin();
$body = read_json_body();
if (($body['action'] ?? '') !== 'switch') json_error(400, 'Неизвестное действие');
try {
    json_out(['ok' => true] + storage_switch((string)($body['mode'] ?? '')));
} catch (Throwable $e) {
    error_log('torsher storage switch: ' . $e->getMessage());
    json_error(409, $e->getMessage());
}
