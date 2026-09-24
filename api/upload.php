<?php
/*
 * POST api/upload.php (multipart, поле "file") — загрузка фото блюда/события.
 * Принимает PNG, WebP, JPEG. Для витрины нужны обтравленные фото с прозрачным фоном —
 * админка проверяет это заранее, сервер сохраняет признак has_alpha.
 * Ответ: { path: "uploads/2026/09/xxxx.webp", width, height, hasAlpha }
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error(405, 'Метод не поддерживается');
require_admin();

$f = $_FILES['file'] ?? null;
if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) json_error(400, 'Файл не получен');
$max = (int)(config()['upload_max_bytes'] ?? 8 * 1024 * 1024);
if ($f['size'] > $max) json_error(413, 'Файл больше ' . round($max / 1048576) . ' МБ');

$mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
$ext = ['image/png' => 'png', 'image/webp' => 'webp', 'image/jpeg' => 'jpg'][$mime] ?? null;
if (!$ext) json_error(415, 'Поддерживаются PNG, WebP и JPEG');
$info = @getimagesize($f['tmp_name']);
if (!$info) json_error(415, 'Файл не похож на изображение');

$hasAlpha = $ext !== 'jpg' && !empty($_POST['hasAlpha']);

$sub = date('Y/m');
$rel = trim((string)(config()['uploads_dir'] ?? 'uploads'), '/') . '/' . $sub;
$dir = ROOT . '/' . $rel;
if (!is_dir($dir) && !mkdir($dir, 0775, true)) json_error(500, 'Нет прав на запись в ' . $rel);
$name = bin2hex(random_bytes(10)) . '.' . $ext;
if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) json_error(500, 'Не удалось сохранить файл');
$path = $rel . '/' . $name;

db()->prepare('INSERT INTO media (path, original_name, mime, width, height, size, has_alpha) VALUES (?,?,?,?,?,?,?)')
    ->execute([$path, mb_substr((string)$f['name'], 0, 255), $mime, $info[0], $info[1], $f['size'], $hasAlpha ? 1 : 0]);

json_out(['path' => $path, 'width' => $info[0], 'height' => $info[1], 'hasAlpha' => $hasAlpha], 201);
