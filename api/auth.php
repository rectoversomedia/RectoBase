<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function inputJson(): array {
    $input = json_decode(file_get_contents('php://input') ?: '{}', true);
    return is_array($input) ? $input : [];
}

function db(): PDO {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $pdo = new PDO('sqlite:' . $dir . '/rectobase.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        outlet TEXT,
        phone TEXT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT "trial",
        whatsapp_limit INTEGER NOT NULL DEFAULT 500,
        created_at TEXT NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )');
    return $pdo;
}

function publicUser(array $row): array {
    return [
        'id' => (int) $row['id'],
        'name' => $row['name'],
        'outlet' => $row['outlet'] ?: 'Toko Saya',
        'phone' => $row['phone'] ?: '',
        'email' => $row['email'],
        'plan' => $row['plan'] ?: 'trial',
        'whatsapp_limit' => (int) ($row['whatsapp_limit'] ?? 500),
    ];
}

$action = strtolower(trim($_GET['action'] ?? 'health'));

try {
    $pdo = db();

    if ($action === 'health') {
        respond(200, ['success' => true, 'message' => 'Auth database ready']);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(405, ['success' => false, 'message' => 'Method not allowed']);
    }

    $input = inputJson();

    if ($action === 'register') {
        $name = trim((string) ($input['name'] ?? ''));
        $outlet = trim((string) ($input['outlet'] ?? ''));
        $phone = preg_replace('/[^0-9+]/', '', (string) ($input['phone'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');

        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8) {
            respond(422, ['success' => false, 'message' => 'Nama, email valid, dan password minimal 8 karakter wajib diisi']);
        }

        $stmt = $pdo->prepare('INSERT INTO users (name, outlet, phone, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$name, $outlet, $phone, $email, password_hash($password, PASSWORD_DEFAULT), gmdate('c')]);

        $row = $pdo->query('SELECT * FROM users WHERE id = ' . (int) $pdo->lastInsertId())->fetch(PDO::FETCH_ASSOC);
        respond(200, ['success' => true, 'user' => publicUser($row)]);
    }

    if ($action === 'login') {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row || !password_verify($password, (string) $row['password_hash'])) {
            respond(401, ['success' => false, 'message' => 'Email atau password salah']);
        }
        respond(200, ['success' => true, 'user' => publicUser($row)]);
    }

    if ($action === 'forgot') {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(422, ['success' => false, 'message' => 'Email tidak valid']);
        }

        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        $code = (string) random_int(100000, 999999);
        $expires = gmdate('c', time() + 30 * 60);
        $reset = $pdo->prepare('INSERT INTO password_resets (user_id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)');
        $reset->execute([$user ? (int) $user['id'] : null, $email, password_hash($code, PASSWORD_DEFAULT), $expires, gmdate('c')]);

        // Email provider belum disambungkan. Reset request tetap tercatat di database.
        respond(200, ['success' => true, 'message' => 'Jika email terdaftar, instruksi reset akan dikirim']);
    }

    respond(404, ['success' => false, 'message' => 'Action tidak dikenal']);
} catch (PDOException $e) {
    if (($e->errorInfo[1] ?? null) === 19) {
        respond(409, ['success' => false, 'message' => 'Email sudah terdaftar']);
    }
    respond(500, ['success' => false, 'message' => 'Database error']);
} catch (Throwable $e) {
    respond(500, ['success' => false, 'message' => 'Server error']);
}
