<?php
// ============================================================
// DōM Collective — Event Share Page
// Serves dynamic OG meta tags for iMessage/social previews,
// then redirects browsers to the main SPA.
// Auto-saves event title to Supabase on first share.
// ============================================================

$eventId = isset($_GET['e']) ? trim($_GET['e']) : '';

// Defaults
$title       = 'DōM Collective';
$description = 'DōM Collective — a creative community space.';
$image       = 'https://dom-collective.com/z.domlogov1.png';
$canonical   = 'https://dom-collective.com/' . ($eventId ? '#event=' . rawurlencode($eventId) : '');

$sbUrl = 'https://lnoixeskupzydjjpbvyu.supabase.co';
$sbKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxub2l4ZXNrdXB6eWRqanBidnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTI3MDksImV4cCI6MjA3NzU4ODcwOX0.a4yw5e_ojAmcdpWWlc8zXXehnjATOfRnVxC22f8tang';

function dom_fetch($url, $headers = []) {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_USERAGENT, 'DomCollective/1.0');
    if ($headers) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $result = curl_exec($ch);
    curl_close($ch);
    return $result ?: null;
}

function dom_upsert($url, $payload, $headers = []) {
    if (!function_exists('curl_init')) return;
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_exec($ch);
    curl_close($ch);
}

if ($eventId) {
    $sbHeaders = ["apikey: $sbKey", "Authorization: Bearer $sbKey", "Accept: application/json"];

    // 1. Check Supabase event_settings first (fast, already stored)
    $sbData = dom_fetch(
        $sbUrl . '/rest/v1/event_settings?event_id=eq.' . rawurlencode($eventId) . '&select=event_title,image_url',
        $sbHeaders
    );
    $alreadySaved = false;
    if ($sbData) {
        $settings = json_decode($sbData, true);
        if (!empty($settings[0]['event_title'])) {
            $title = $settings[0]['event_title'] . ' — DōM Collective';
            $alreadySaved = true;
        }
        if (!empty($settings[0]['image_url'])) {
            $image = $settings[0]['image_url'];
        }
    }

    // 2. If title not in Supabase yet, fetch from Google Calendar and auto-save
    if (!$alreadySaved) {
        $calId = 'd392dc35dbd1a2f8807f396fcc095f16fe662aaabce1ac6df94e2100aae3378c@group.calendar.google.com';
        $gcKey = 'AIzaSyCU8sdOOUT5LP145Doy7R7MGlJmgtOs3Ls';
        $gcData = dom_fetch(
            'https://www.googleapis.com/calendar/v3/calendars/'
            . rawurlencode($calId) . '/events/'
            . rawurlencode($eventId) . '?key=' . $gcKey
        );
        if ($gcData) {
            $ev = json_decode($gcData, true);
            if (!empty($ev['summary'])) {
                $title = $ev['summary'] . ' — DōM Collective';
                if (!empty($ev['description'])) {
                    $description = substr(strip_tags($ev['description']), 0, 200);
                }
                // Auto-save title to Supabase so future shares skip the Google Calendar call
                dom_upsert(
                    $sbUrl . '/rest/v1/event_settings',
                    ['event_id' => $eventId, 'event_title' => $ev['summary']],
                    array_merge($sbHeaders, [
                        "Content-Type: application/json",
                        "Prefer: resolution=merge-duplicates"
                    ])
                );
            }
        }
    }
}

// Escape for HTML output
$safeTitle       = htmlspecialchars($title,       ENT_QUOTES, 'UTF-8');
$safeDescription = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');
$safeImage       = htmlspecialchars($image,       ENT_QUOTES, 'UTF-8');
$safeCanonical   = htmlspecialchars($canonical,   ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title><?= $safeTitle ?></title>
  <meta name="description" content="<?= $safeDescription ?>">
  <meta property="og:type"        content="website">
  <meta property="og:site_name"   content="DōM Collective">
  <meta property="og:title"       content="<?= $safeTitle ?>">
  <meta property="og:description" content="<?= $safeDescription ?>">
  <meta property="og:url"         content="<?= $safeCanonical ?>">
  <meta property="og:image"       content="<?= $safeImage ?>">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="<?= $safeTitle ?>">
  <meta name="twitter:description" content="<?= $safeDescription ?>">
  <meta name="twitter:image"       content="<?= $safeImage ?>">
  <script>
    var id = new URLSearchParams(location.search).get('e');
    location.replace('https://dom-collective.com/' + (id ? '#event=' + encodeURIComponent(id) : ''));
  </script>
</head>
<body>
  <a href="https://dom-collective.com"><?= $safeTitle ?></a>
</body>
</html>
