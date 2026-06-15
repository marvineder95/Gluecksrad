<?php
require_once __DIR__ . '/../config/bootstrap.php';

// GET /api/themes - Liste aller verfügbaren Themes
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Rate-Limiting: max. 60 Requests pro Minute pro IP
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    checkRateLimit('themes:' . $clientIp, 60, 60);
    
    $themes = [
        [
            'id' => 'dove',
            'name' => 'Standard',
            'image' => 'frontend/assets/themes/dove.jpg'
        ],
        [
            'id' => 'ocean',
            'name' => 'Ozean',
            'image' => 'frontend/assets/themes/ocean.jpg'
        ],
        [
            'id' => 'flowers',
            'name' => 'Blumen',
            'image' => 'frontend/assets/themes/flowers.jpg'
        ],
        [
            'id' => 'mountains',
            'name' => 'Berge',
            'image' => 'frontend/assets/themes/mountains.jpg'
        ],
        [
            'id' => 'forest',
            'name' => 'Wald',
            'image' => 'frontend/assets/themes/forest.jpg'
        ],
        [
            'id' => 'sunset',
            'name' => 'Sonnenuntergang',
            'image' => 'frontend/assets/themes/sunset.jpg'
        ]
    ];
    
    jsonResponse(['themes' => $themes]);
}
