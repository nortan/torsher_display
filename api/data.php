<?php
/*
 * GET  api/data.php            — все данные витрины (публично, их читает экран)
 * GET  api/data.php?revision=1 — только номер ревизии (лёгкая проверка обновлений)
 * PUT  api/data.php            — сохранить данные целиком (вход + X-CSRF-Token)
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (isset($_GET['revision'])) {
        $rev = db()->query('SELECT version FROM site WHERE id = 1')->fetchColumn();
        json_out(['revision' => (int)$rev]);
    }
    json_out(load_data());
}

if ($method === 'PUT' || $method === 'POST') {
    require_admin();
    $rev = save_data(read_json_body());
    json_out(['ok' => true, 'revision' => $rev]);
}

header('Allow: GET, PUT, POST');
json_error(405, 'Метод не поддерживается');
