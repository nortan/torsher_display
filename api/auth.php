<?php
/*
 * GET  api/auth.php                          — текущий пользователь и CSRF-токен (или 401)
 * POST api/auth.php {action:"login", login, password}
 * POST api/auth.php {action:"logout"}        — требуется X-CSRF-Token
 * POST api/auth.php {action:"password", current, next} — смена пароля
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

start_session();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $user = current_user();
    if (!$user) json_out(['error' => 'Требуется вход', 'csrf' => $_SESSION['csrf']], 401);
    json_out(['user' => $user, 'csrf' => $_SESSION['csrf'], 'storage' => storage_mode()]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error(405, 'Метод не поддерживается');

$body = read_json_body();
$action = $body['action'] ?? '';

if ($action === 'login') {
    $login = trim((string)($body['login'] ?? ''));
    $password = (string)($body['password'] ?? '');
    $u = user_find($login);
    if (!$u || !password_verify($password, $u['password_hash'])) {
        usleep(700000); // замедляем перебор паролей
        json_error(401, 'Неверный логин или пароль');
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$u['id'];
    $_SESSION['login'] = $u['login'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    json_out(['user' => ['id' => (int)$u['id'], 'login' => $u['login']], 'csrf' => $_SESSION['csrf'], 'storage' => storage_mode()]);
}

if ($action === 'logout') {
    require_admin();
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true]);
}

if ($action === 'password') {
    $user = require_admin();
    $next = (string)($body['next'] ?? '');
    if (mb_strlen($next) < 8) json_error(422, 'Новый пароль — не короче 8 символов');
    $u = user_by_id((int)$user['id']);
    if (!$u || !password_verify((string)($body['current'] ?? ''), (string)$u['password_hash'])) json_error(403, 'Текущий пароль неверен');
    user_set_password((int)$user['id'], password_hash($next, PASSWORD_DEFAULT));
    json_out(['ok' => true]);
}

json_error(400, 'Неизвестное действие');
