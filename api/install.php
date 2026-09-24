<?php
/*
 * Первичная установка: создаёт таблицы, первого администратора и загружает стартовые
 * данные из content/data.json.
 *
 *   В браузере: https://ваш-сайт/api/install.php  (форма логина и пароля)
 *   В консоли:  php api/install.php admin 'надёжный-пароль'
 *
 * Работает, только пока в базе нет пользователей и в config.php install_enabled = true.
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

$cli = PHP_SAPI === 'cli';

function installed(): bool
{
    try {
        return count(users_all()) > 0;
    } catch (Throwable $e) {
        return false;
    }
}

/* Установка в выбранное хранилище: 'db' (MySQL) или 'files' (JSON в папке data/). */
function install(string $login, string $password, string $mode): string
{
    if (!preg_match('/^[A-Za-z0-9_.@-]{3,64}$/', $login)) throw new RuntimeException('Логин: 3–64 символа, латиница, цифры, _.@-');
    if (mb_strlen($password) < 8) throw new RuntimeException('Пароль — не короче 8 символов');
    if (!in_array($mode, STORAGE_MODES, true)) throw new RuntimeException('Хранилище: db или files');
    $err = $mode === 'db' ? db_try() : files_try();
    if ($err) throw new RuntimeException($err);

    storage_force_mode($mode);
    if ($mode === 'db') ensure_db_schema();
    if (installed()) throw new RuntimeException('Уже установлено');

    $raw = (string)@file_get_contents(ROOT . '/content/data.json');
    $seed = json_decode($raw, true) ?: [];
    save_data(['cafe' => $seed['cafe'] ?? [], 'settings' => $seed['settings'] ?? [], 'ticker' => $seed['ticker'] ?? [],
        'dishes' => $seed['dishes'] ?? [], 'events' => $seed['events'] ?? [], 'slides' => $seed['slides'] ?? []], json_decode($raw));
    user_create($login, password_hash($password, PASSWORD_DEFAULT));
    try { storage_set_mode($mode); } catch (Throwable $e) { if ($mode === 'files') throw $e; } // для MySQL папка data/ не обязательна

    return sprintf('Готово (%s): загружено блюд — %d, мероприятий — %d, слайдов — %d. Администратор: %s',
        $mode === 'db' ? 'хранение в базе данных' : 'хранение в файлах ' . data_dir(),
        count($seed['dishes'] ?? []), count($seed['events'] ?? []), count($seed['slides'] ?? []), $login);
}

if (empty(config()['install_enabled'])) {
    $msg = 'Установка отключена (install_enabled = false в api/config.php).';
    if ($cli) { fwrite(STDERR, $msg . "\n"); exit(1); }
    http_response_code(403); exit($msg);
}

if ($cli) {
    [$_, $login, $password, $mode] = array_pad($argv, 4, '');
    if ($login === '' || $password === '') { fwrite(STDERR, "Использование: php api/install.php <логин> <пароль> [db|files]\n"); exit(1); }
    try { echo install($login, $password, $mode ?: (string)(config()['storage'] ?? 'db')), "\n"; exit(0); }
    catch (Throwable $e) { fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n"); exit(1); }
}

$message = '';
$ok = false;
if (installed()) {
    $message = 'Витрина уже установлена. Для безопасности выключите install_enabled в api/config.php.';
    $ok = true;
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try { $message = install((string)($_POST['login'] ?? ''), (string)($_POST['password'] ?? ''), (string)($_POST['storage'] ?? 'db')); $ok = true; }
    catch (Throwable $e) { $message = 'Ошибка: ' . $e->getMessage(); }
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Установка витрины</title>
  <link rel="stylesheet" href="../vendor/bootstrap/bootstrap.min.css">
</head>
<body class="bg-body-tertiary">
  <main class="container py-5" style="max-width: 520px">
    <h1 class="h3 mb-3">Установка витрины</h1>
    <?php if ($message): ?>
      <div class="alert <?= $ok ? 'alert-success' : 'alert-danger' ?>"><?= $h($message) ?></div>
    <?php endif; ?>
    <?php if ($ok): ?>
      <a class="btn btn-primary" href="../admin/">Перейти в админку</a>
    <?php else: ?>
      <form method="post" class="card card-body">
        <p class="text-body-secondary">Будут созданы хранилище, первый администратор и стартовые данные из <code>content/data.json</code>.</p>
        <div class="mb-3">
          <label class="form-label">Где хранить данные</label>
          <?php $dbErr = db_try(); $fErr = files_try(); $def = (string)(config()['storage'] ?? 'db'); ?>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="storage" id="stDb" value="db" <?= $def !== 'files' ? 'checked' : '' ?> <?= $dbErr ? 'disabled' : '' ?>>
            <label class="form-check-label" for="stDb">В базе данных MySQL <?= $dbErr ? '<span class="text-danger small">— ' . $h($dbErr) . '</span>' : '' ?></label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="storage" id="stFiles" value="files" <?= $def === 'files' || $dbErr ? 'checked' : '' ?> <?= $fErr ? 'disabled' : '' ?>>
            <label class="form-check-label" for="stFiles">В файлах на сервере (папка <code><?= $h(data_dir()) ?></code>) <?= $fErr ? '<span class="text-danger small">— ' . $h($fErr) . '</span>' : '' ?></label>
          </div>
          <div class="form-text">Режим можно поменять позже в админке: Публикация → «Хранение данных» (данные перенесутся).</div>
        </div>
        <div class="mb-3"><label class="form-label">Логин администратора</label><input class="form-control" name="login" required pattern="[A-Za-z0-9_.@-]{3,64}" value="admin"></div>
        <div class="mb-3"><label class="form-label">Пароль (от 8 символов)</label><input class="form-control" type="password" name="password" minlength="8" required></div>
        <button class="btn btn-primary">Установить</button>
      </form>
    <?php endif; ?>
  </main>
</body>
</html>
