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

function installed(PDO $pdo): bool
{
    try {
        return (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0;
    } catch (PDOException $e) {
        return false;
    }
}

function install(string $login, string $password): string
{
    if (!preg_match('/^[A-Za-z0-9_.@-]{3,64}$/', $login)) throw new RuntimeException('Логин: 3–64 символа, латиница, цифры, _.@-');
    if (mb_strlen($password) < 8) throw new RuntimeException('Пароль — не короче 8 символов');

    $pdo = db();
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $schema = file_get_contents(ROOT . '/sql/schema.' . ($driver === 'sqlite' ? 'sqlite' : 'mysql') . '.sql');
    $schema = preg_replace('/^--.*$/m', '', $schema);
    foreach (array_filter(array_map('trim', explode(';', $schema))) as $sql) $pdo->exec($sql);

    if (installed($pdo)) throw new RuntimeException('Уже установлено');

    $raw = (string)@file_get_contents(ROOT . '/content/data.json');
    $seed = json_decode($raw, true) ?: [];
    $seedObjects = json_decode($raw);
    $enc = fn($v) => json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $pdo->exec('DELETE FROM site');
    $pdo->prepare('INSERT INTO site (id, cafe, settings, ticker, version) VALUES (1, ?, ?, ?, 1)')
        ->execute([$enc($seed['cafe'] ?? ['name' => 'Кафе']), $enc($seed['settings'] ?? new stdClass()), $enc($seed['ticker'] ?? [])]);
    save_data(['cafe' => $seed['cafe'] ?? [], 'settings' => $seed['settings'] ?? [], 'ticker' => $seed['ticker'] ?? [],
        'dishes' => $seed['dishes'] ?? [], 'events' => $seed['events'] ?? [], 'slides' => $seed['slides'] ?? []], $seedObjects);

    $pdo->prepare('INSERT INTO users (login, password_hash) VALUES (?, ?)')->execute([$login, password_hash($password, PASSWORD_DEFAULT)]);
    return sprintf('Готово: таблицы созданы, загружено блюд — %d, мероприятий — %d, слайдов — %d. Администратор: %s',
        count($seed['dishes'] ?? []), count($seed['events'] ?? []), count($seed['slides'] ?? []), $login);
}

if (empty(config()['install_enabled'])) {
    $msg = 'Установка отключена (install_enabled = false в api/config.php).';
    if ($cli) { fwrite(STDERR, $msg . "\n"); exit(1); }
    http_response_code(403); exit($msg);
}

if ($cli) {
    [$_, $login, $password] = array_pad($argv, 3, '');
    if ($login === '' || $password === '') { fwrite(STDERR, "Использование: php api/install.php <логин> <пароль>\n"); exit(1); }
    try { echo install($login, $password), "\n"; exit(0); }
    catch (Throwable $e) { fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n"); exit(1); }
}

$message = '';
$ok = false;
if (installed(db())) {
    $message = 'Витрина уже установлена. Для безопасности выключите install_enabled в api/config.php.';
    $ok = true;
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try { $message = install((string)($_POST['login'] ?? ''), (string)($_POST['password'] ?? '')); $ok = true; }
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
        <p class="text-body-secondary">Будут созданы таблицы в MySQL, первый администратор и стартовые данные из <code>content/data.json</code>.</p>
        <div class="mb-3"><label class="form-label">Логин администратора</label><input class="form-control" name="login" required pattern="[A-Za-z0-9_.@-]{3,64}" value="admin"></div>
        <div class="mb-3"><label class="form-label">Пароль (от 8 символов)</label><input class="form-control" type="password" name="password" minlength="8" required></div>
        <button class="btn btn-primary">Установить</button>
      </form>
    <?php endif; ?>
  </main>
</body>
</html>
