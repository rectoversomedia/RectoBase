<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// ── CORS: only allow same-origin (browser enforces, belt-and-suspenders) ──────
$origin = ($_SERVER['HTTP_ORIGIN'] ?? '');
$host   = ($_SERVER['HTTP_HOST']   ?? '');
if ($origin && parse_url($origin, PHP_URL_HOST) !== $host) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Forbidden']);
    exit;
}

// ── Config from env (set via fastcgi_param in Nginx) ─────────────────────────
$apiKey       = getenv('TRIPAY_API_KEY')       ?: '';
$privateKey   = getenv('TRIPAY_PRIVATE_KEY')   ?: '';
$merchantCode = getenv('TRIPAY_MERCHANT_CODE') ?: '';
$mode         = strtolower(getenv('TRIPAY_MODE') ?: 'production');
$baseUrl      = $mode === 'sandbox'
    ? 'https://tripay.co.id/api-sandbox'
    : 'https://tripay.co.id/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
function respond(int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function requireConfig(string $key, string $pk, string $mc): void {
    if ($key === '' || $pk === '' || $mc === '') {
        respond(503, [
            'success' => false,
            'message' => 'Tripay belum dikonfigurasi. Set TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE di server.',
            'hint'    => 'Jalankan: sudo bash setup-tripay.sh di VPS.',
        ]);
    }
}

function tripayRequest(string $method, string $url, string $apiKey, array $payload = []): array {
    $ch = curl_init();
    $opts = [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => false,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FAILONERROR    => false,
        CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FRESH_CONNECT  => true,
    ];
    if ($method === 'POST') {
        $opts[CURLOPT_POST]       = true;
        $opts[CURLOPT_POSTFIELDS] = http_build_query($payload);
    }
    curl_setopt_array($ch, $opts);
    $raw    = curl_exec($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE) ?: 502;
    curl_close($ch);

    if ($err !== '' || $raw === false) {
        respond(502, ['success' => false, 'message' => 'Gagal hubungi Tripay: ' . ($err ?: 'empty response')]);
    }
    $json = json_decode((string) $raw, true);
    if (!is_array($json)) {
        respond(502, ['success' => false, 'message' => 'Response Tripay tidak valid JSON', 'raw' => substr((string)$raw, 0, 300)]);
    }
    http_response_code($status);
    return $json;
}

function planAmount(string $plan, string $billing): int {
    $monthly       = $plan === 'pro' ? 99900  : 49900;
    $annualMonthly = $plan === 'pro' ? 79900  : 39900;
    return $billing === 'annual' ? $annualMonthly * 12 : $monthly;
}

function siteOrigin(): string {
    $proto = ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ($_SERVER['HTTPS'] ?? 'off') !== 'off') ? 'https' : 'http';
    $host  = $_SERVER['HTTP_HOST'] ?? 'base.rectoversomedia.com';
    return $proto . '://' . $host;
}

// ── Router ────────────────────────────────────────────────────────────────────
$action = strtolower(trim($_GET['action'] ?? 'create'));

// ── TEST: verify config without real transaction ──────────────────────────────
if ($action === 'test') {
    $configured = ($apiKey !== '' && $privateKey !== '' && $merchantCode !== '');
    respond(200, [
        'success'     => $configured,
        'message'     => $configured ? 'Tripay configured OK' : 'Tripay belum dikonfigurasi',
        'mode'        => $mode,
        'merchant'    => $configured ? substr($merchantCode, 0, 4) . '****' : null,
        'php_version' => PHP_VERSION,
        'curl'        => extension_loaded('curl'),
    ]);
}

// ── CALLBACK: Tripay → our server ────────────────────────────────────────────
if ($action === 'callback') {
    requireConfig($apiKey, $privateKey, $merchantCode);

    $raw      = file_get_contents('php://input') ?: '';
    $expected = hash_hmac('sha256', $raw, $privateKey);
    $actual   = $_SERVER['HTTP_X_CALLBACK_SIGNATURE'] ?? '';
    $event    = $_SERVER['HTTP_X_CALLBACK_EVENT']     ?? '';

    if (!hash_equals($expected, $actual)) {
        respond(401, ['success' => false, 'message' => 'Invalid signature']);
    }
    if ($event !== 'payment_status') {
        respond(400, ['success' => false, 'message' => 'Unexpected event: ' . htmlspecialchars($event)]);
    }
    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        respond(400, ['success' => false, 'message' => 'Invalid payload']);
    }

    // Log callback (rotate at 5MB)
    $logFile = __DIR__ . '/tripay-callbacks.log';
    if (file_exists($logFile) && filesize($logFile) > 5 * 1024 * 1024) {
        rename($logFile, $logFile . '.' . date('Ymd') . '.bak');
    }
    file_put_contents($logFile,
        json_encode(['ts' => gmdate('c'), 'payload' => $payload], JSON_UNESCAPED_SLASHES) . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );

    // TODO: update subscription status in DB based on $payload['merchant_ref'] and $payload['status']
    // For now, we acknowledge receipt.
    respond(200, ['success' => true]);
}

// ── DETAIL: check transaction status ─────────────────────────────────────────
if ($action === 'detail') {
    requireConfig($apiKey, $privateKey, $merchantCode);
    $ref = trim((string) ($_GET['reference'] ?? ''));
    if ($ref === '') {
        respond(422, ['success' => false, 'message' => 'Parameter reference wajib diisi']);
    }
    // Sanitise: only allow alphanumeric + dash/underscore
    if (!preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $ref)) {
        respond(422, ['success' => false, 'message' => 'Reference tidak valid']);
    }
    respond(200, tripayRequest('GET', $baseUrl . '/transaction/detail?' . http_build_query(['reference' => $ref]), $apiKey));
}

// ── CREATE: new closed-payment transaction ────────────────────────────────────
if ($action !== 'create') {
    respond(404, ['success' => false, 'message' => 'Action tidak dikenal: ' . htmlspecialchars($action)]);
}
requireConfig($apiKey, $privateKey, $merchantCode);

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['success' => false, 'message' => 'Method not allowed']);
}

$input = json_decode(file_get_contents('php://input') ?: '{}', true);
if (!is_array($input)) {
    respond(400, ['success' => false, 'message' => 'Request body harus JSON yang valid']);
}

// Allowed closed-payment methods
$allowedMethods = ['QRIS', 'QRIS2', 'QRISC', 'BRIVA', 'BCAVA', 'MANDIRIVA', 'BNIVA', 'PERMATAVA'];
$method         = strtoupper(trim((string) ($input['method'] ?? 'QRIS')));
if (!in_array($method, $allowedMethods, true)) {
    respond(422, ['success' => false, 'message' => 'Metode tidak didukung: ' . htmlspecialchars($method)]);
}

$plan    = in_array(strtolower((string)($input['plan']    ?? '')), ['basic','pro'], true)    ? strtolower((string)$input['plan'])    : 'pro';
$billing = in_array(strtolower((string)($input['billing'] ?? '')), ['monthly','annual'], true) ? strtolower((string)$input['billing']) : 'monthly';
$amount  = planAmount($plan, $billing);   // always use server-computed amount (never trust client)

$customerName  = trim((string) ($input['customer_name']  ?? '')) ?: 'Pelanggan RectoBase';
$customerEmail = trim((string) ($input['customer_email'] ?? ''));
if (!filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
    $customerEmail = 'customer@rectobase.local';
}
$customerPhone = preg_replace('/[^0-9+]/', '', (string) ($input['customer_phone'] ?? ''));

$merchantRef = 'RB-' . strtoupper($plan) . '-' . date('YmdHis') . '-' . random_int(1000, 9999);
$origin      = siteOrigin();
$expiredTime = time() + (24 * 60 * 60); // 24 hours

$body = [
    'method'        => $method,
    'merchant_ref'  => $merchantRef,
    'amount'        => $amount,
    'customer_name' => $customerName,
    'customer_email'=> $customerEmail,
    'customer_phone'=> $customerPhone,
    'order_items'   => [[
        'sku'      => 'RB-' . strtoupper($plan) . '-' . strtoupper($billing),
        'name'     => 'RectoBase ' . ucfirst($plan) . ' ' . ($billing === 'annual' ? 'Tahunan' : 'Bulanan'),
        'price'    => $amount,
        'quantity' => 1,
    ]],
    'callback_url'  => $origin . '/api/tripay.php?action=callback',
    'return_url'    => $origin . '/#payment',
    'expired_time'  => $expiredTime,
    'signature'     => hash_hmac('sha256', $merchantCode . $merchantRef . $amount, $privateKey),
];

$result = tripayRequest('POST', $baseUrl . '/transaction/create', $apiKey, $body);

// Normalize response: make sure frontend-relevant fields are always present
if (isset($result['data']) && is_array($result['data'])) {
    $d = &$result['data'];
    $d['merchant_ref']  = $d['merchant_ref']  ?? $merchantRef;
    $d['payment_name']  = $d['payment_name']  ?? $method;
    $d['pay_code']      = $d['pay_code']       ?? ($d['qr_string'] ?? null);
    $d['qr_url']        = $d['qr_url']         ?? null;
    $d['instructions']  = $d['instructions']   ?? [];
    $d['status']        = $d['status']         ?? 'UNPAID';
    $d['expired_time']  = $d['expired_time']   ?? $expiredTime;
}

respond(200, $result);
