<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'POST required']);
}

$apiKey = getenv('GOPIC_GEMINI_API_KEY');
if (!$apiKey) {
    $keyFile = '/home/u599982929/.gopic_gemini_api_key';
    if (is_readable($keyFile)) {
        $apiKey = trim((string)file_get_contents($keyFile));
    }
}
if (!$apiKey) {
    respond(500, ['error' => 'GOPIC_GEMINI_API_KEY is not configured on the server']);
}

if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    respond(400, ['error' => 'A valid image upload is required']);
}

$file = $_FILES['image'];
if (($file['size'] ?? 0) <= 0 || $file['size'] > 12 * 1024 * 1024) {
    respond(400, ['error' => 'Image must be between 1 byte and 12 MB']);
}

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = $finfo->file($file['tmp_name']);
$allowed = ['image/jpeg', 'image/png', 'image/webp'];
if (!in_array($mime, $allowed, true)) {
    respond(400, ['error' => 'Only JPEG, PNG, and WebP images are supported']);
}

$bytes = file_get_contents($file['tmp_name']);
if ($bytes === false) {
    respond(500, ['error' => 'Could not read uploaded image']);
}

$locationHint = trim((string)($_POST['locationHint'] ?? ''));
$imageB64 = base64_encode($bytes);

$prompt = <<<TXT
You are the visual analysis component of GoPic for Agents.

Goal:
Read the visible storefront/sign text from the supplied image and identify useful place-search candidates.

Rules:
- Preserve visible sign text exactly as written whenever possible.
- Do not translate, autocorrect, or invent missing characters.
- Do not claim a place is verified from the image alone.
- If a location hint is provided, use it only as contextual evidence.
- Return very concise structured data.
- Return at most 2 candidates.
- Each candidate reason must be 15 words or fewer.
- Candidate names should be based on visible evidence, not guesses.
- If evidence is insufficient, return an empty candidates array and verifiedPlace as an empty string.

Location hint:
{$locationHint}
TXT;

$schema = [
    'type' => 'object',
    'properties' => [
        'ocrText' => [
            'type' => 'string',
            'description' => 'Best-effort transcription of the important visible storefront/sign text, preserving original script.'
        ],
        'candidates' => [
            'type' => 'array',
            'maxItems' => 2,
            'items' => [
                'type' => 'object',
                'properties' => [
                    'name' => ['type' => 'string'],
                    'location' => ['type' => 'string'],
                    'reason' => ['type' => 'string']
                ],
                'required' => ['name', 'location', 'reason'],
                'additionalProperties' => false
            ]
        ],
        'verifiedPlace' => [
            'type' => 'string',
            'description' => 'Leave empty unless the supplied visual evidence and location hint make one candidate clearly dominant.'
        ]
    ],
    'required' => ['ocrText', 'candidates', 'verifiedPlace'],
    'additionalProperties' => false
];

$body = [
    'model' => 'gemini-3.7-flash',
    'input' => [
        [
            'type' => 'text',
            'text' => $prompt
        ],
        [
            'type' => 'image',
            'data' => $imageB64,
            'mime_type' => $mime
        ]
    ],
    'response_format' => [
        'type' => 'text',
        'mime_type' => 'application/json',
        'schema' => $schema
    ]
];

$ch = curl_init('https://generativelanguage.googleapis.com/v1beta/interactions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 45,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'x-goog-api-key: ' . $apiKey,
        'Api-Revision: 2026-05-20'
    ],
    CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
]);

$raw = curl_exec($ch);
$errno = curl_errno($ch);
$error = curl_error($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($errno !== 0 || $raw === false) {
    respond(502, ['error' => 'Gemini request failed', 'detail' => $error]);
}

$decoded = json_decode($raw, true);
if (!is_array($decoded)) {
    respond(502, ['error' => 'Gemini returned invalid JSON']);
}

if ($status < 200 || $status >= 300) {
    respond(502, [
        'error' => 'Gemini API error',
        'status' => $status,
        'detail' => $decoded['error']['message'] ?? 'Unknown Gemini API error'
    ]);
}

/*
 * The Interactions API returns generated text in output_text for the normal
 * text-output path. Keep a small compatibility fallback for nested outputs.
 */
$outputText = $decoded['output_text'] ?? null;

if (!is_string($outputText) || trim($outputText) === '') {
    $outputText = null;

    $walk = function ($node) use (&$walk, &$outputText) {
        if ($outputText !== null || !is_array($node)) return;

        foreach ($node as $key => $value) {
            if ($outputText !== null) return;

            if (($key === 'text' || $key === 'output_text') && is_string($value) && trim($value) !== '') {
                $candidate = trim($value);
                if ($candidate !== '') {
                    $outputText = $candidate;
                    return;
                }
            }

            if (is_array($value)) {
                $walk($value);
            }
        }
    };

    $walk($decoded);
}

if (!is_string($outputText) || trim($outputText) === '') {
    respond(502, [
        'error' => 'Gemini response did not contain structured text output'
    ]);
}

$result = json_decode($outputText, true);
if (!is_array($result)) {
    respond(502, [
        'error' => 'Could not parse Gemini structured output',
        'raw' => mb_substr($outputText, 0, 800)
    ]);
}

$result['ocrText'] = trim((string)($result['ocrText'] ?? ''));
$result['verifiedPlace'] = trim((string)($result['verifiedPlace'] ?? ''));
$result['candidates'] = is_array($result['candidates'] ?? null) ? $result['candidates'] : [];

$result['meta'] = [
    'engine' => 'gemini-3.7-flash',
    'locationHint' => $locationHint,
    'source' => 'GoPic WebMCP Challenge web demo'
];

respond(200, $result);
