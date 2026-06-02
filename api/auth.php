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

function dataFile(): string {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir . '/auth-store.json';
}

function defaultStore(): array {
    return ['next_user_id' => 1, 'users' => [], 'password_resets' => []];
}

function withStore(callable $handler) {
    $file = dataFile();
    $fh = fopen($file, 'c+');
    if (!$fh) {
        throw new RuntimeException('Cannot open auth store');
    }
    try {
        if (!flock($fh, LOCK_EX)) {
            throw new RuntimeException('Cannot lock auth store');
        }
        $raw = stream_get_contents($fh);
        $store = $raw ? json_decode($raw, true) : defaultStore();
        if (!is_array($store)) {
            $store = defaultStore();
        }
        $store += defaultStore();
        $result = $handler($store);

        rewind($fh);
        ftruncate($fh, 0);
        fwrite($fh, json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        fflush($fh);
        flock($fh, LOCK_UN);
        return $result;
    } finally {
        fclose($fh);
    }
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

function findUserIndexByEmail(array $users, string $email): int {
    foreach ($users as $idx => $user) {
        if (strtolower((string) ($user['email'] ?? '')) === $email) {
            return (int) $idx;
        }
    }
    return -1;
}

$action = strtolower(trim($_GET['action'] ?? 'health'));

try {
    if ($action === 'health') {
        withStore(fn(array &$store) => true);
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

        $user = withStore(function (array &$store) use ($name, $outlet, $phone, $email, $password): array {
            if (findUserIndexByEmail($store['users'], $email) >= 0) {
                respond(409, ['success' => false, 'message' => 'Email sudah terdaftar']);
            }
            $row = [
                'id' => (int) $store['next_user_id'],
                'name' => $name,
                'outlet' => $outlet,
                'phone' => $phone,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'plan' => 'trial',
                'whatsapp_limit' => 500,
                'created_at' => gmdate('c'),
            ];
            $store['next_user_id'] = (int) $store['next_user_id'] + 1;
            $store['users'][] = $row;
            return publicUser($row);
        });
        respond(200, ['success' => true, 'user' => $user]);
    }

    if ($action === 'login') {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $user = withStore(function (array &$store) use ($email, $password): ?array {
            $idx = findUserIndexByEmail($store['users'], $email);
            if ($idx < 0) return null;
            $row = $store['users'][$idx];
            if (!password_verify($password, (string) ($row['password_hash'] ?? ''))) return null;
            $store['users'][$idx]['last_login_at'] = gmdate('c');
            return publicUser($store['users'][$idx]);
        });
        if (!$user) {
            respond(401, ['success' => false, 'message' => 'Email atau password salah']);
        }
        respond(200, ['success' => true, 'user' => $user]);
    }

    if ($action === 'forgot') {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(422, ['success' => false, 'message' => 'Email tidak valid']);
        }
        withStore(function (array &$store) use ($email): bool {
            $idx = findUserIndexByEmail($store['users'], $email);
            $userId = $idx >= 0 ? (int) $store['users'][$idx]['id'] : null;
            $code = (string) random_int(100000, 999999);
            $store['password_resets'][] = [
                'user_id' => $userId,
                'email' => $email,
                'code_hash' => password_hash($code, PASSWORD_DEFAULT),
                'expires_at' => gmdate('c', time() + 30 * 60),
                'used_at' => null,
                'created_at' => gmdate('c'),
            ];
            return true;
        });
        respond(200, ['success' => true, 'message' => 'Jika email terdaftar, instruksi reset akan dikirim']);
    }

    respond(404, ['success' => false, 'message' => 'Action tidak dikenal']);
} catch (Throwable $e) {
    respond(500, ['success' => false, 'message' => 'Auth storage error']);
}
