#!/usr/bin/env php
<?php
/*
 * Печатает api/config.php из переменных окружения (для .github/workflows/deploy-ftp.yml).
 * Аргумент: 1 — установщик включён, 0 — выключен.
 * Переменные: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, APP_KEY (необязательно).
 * Пароли берутся только из окружения (секретов GitHub) и в репозиторий не попадают.
 */
$env = fn($k, $d = '') => ($v = getenv($k)) !== false && $v !== '' ? $v : $d;
$dbPass = $env('DB_PASSWORD');
$cfg = [
    'db' => [
        'dsn'      => 'mysql:host=' . $env('DB_HOST', 'localhost') . ';dbname=' . $env('DB_NAME', $env('DB_USER')) . ';charset=utf8mb4',
        'user'     => $env('DB_USER'),
        'password' => $dbPass,
    ],
    'storage'          => 'db',
    'data_dir'         => 'data',
    'uploads_dir'      => 'uploads',
    'upload_max_bytes' => 8 * 1024 * 1024,
    // Ключ должен быть постоянным между выкладками, иначе пароль FTP в админке придётся вводить заново.
    'app_key'          => $env('APP_KEY', hash('sha256', 'torsher-display|' . $dbPass)),
    'install_enabled'  => ($argv[1] ?? '0') === '1',
];
echo "<?php\n/* Создан при выкладке (deploy-ftp.yml). Не редактируйте на сервере — перезапишется. */\nreturn ",
    var_export($cfg, true), ";\n";
