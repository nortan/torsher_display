<?php
/*
 * Скопируйте в api/config.php и заполните. config.php не хранится в git.
 */
return [
    // Подключение к MySQL / MariaDB (не нужно, если storage = 'files')
    'db' => [
        'dsn'      => 'mysql:host=localhost;dbname=torsher_display;charset=utf8mb4',
        'user'     => 'torsher',
        'password' => 'change-me',
    ],

    // Где хранить данные витрины: 'db' — в MySQL (ниже), 'files' — JSON-файлы в папке data_dir.
    // Переключается и в админке (Публикация → «Хранение данных»); выбор админки имеет приоритет.
    'storage'  => 'db',
    'data_dir' => 'data',   // относительно корня сайта или абсолютный путь (лучше — вне веб-корня)

    // Куда складывать загруженные фото (относительно корня сайта) и ограничение размера
    'uploads_dir'      => 'uploads',
    'upload_max_bytes' => 8 * 1024 * 1024,

    // Ключ шифрования секретов (пароль FTP). Любая случайная строка от 32 символов, например:
    //   php -r "echo bin2hex(random_bytes(32));"
    'app_key' => '',

    // Установка: api/install.php создаёт таблицы и первого администратора.
    // После установки поставьте false (или удалите install.php).
    'install_enabled' => true,
];
