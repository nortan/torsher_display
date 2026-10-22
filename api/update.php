<?php
/*
 * POST api/update.php — обновить контент витрины из content/data.json в репозитории.
 * Нужен вход и CSRF (как PUT api/data.php). Возвращает { ok, revision }.
 *
 * Используется кнопкой «Обновить контент из репозитория» в админке и CI-деплоем.
 * Данные проходят ту же нормализацию и белые списки, что и обычное сохранение.
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    json_error(405, 'Метод не поддерживается');
}
require_admin();

$raw = (string)@file_get_contents(ROOT . '/content/data.json');
$d = json_decode($raw, true);
if (!is_array($d) || !isset($d['slides']) || !isset($d['dishes'])) {
    json_error(422, 'content/data.json не найден или не является данными витрины');
}
// серверные служебные поля сида не принимаем
unset($d['revision'], $d['updatedAt']);

$rev = save_data($d, json_decode($raw));
json_out(['ok' => true, 'revision' => $rev]);
