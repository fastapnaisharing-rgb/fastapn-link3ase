# FastAPN SP Listener (local helper) - MARKER_SP_LISTENER_V1
# Listens on 127.0.0.1 only. The Link3ase web page calls POST /run with a fastapn-sp:// URI as text body,
# and this script hands it to fastapn-sp.ps1 (same as the browser protocol launch) WITHOUT the browser prompt.
# Security: only requests whose Origin header is in the allow list (default: http://10.101.87.126:8081,
#   plus extra origins in fastapn-sp-listener.allow, one per line) are served; URI must start with fastapn-sp://
$ListenerVersion = 3   # v2: รับ fastapn:// (Outlook Handler) | v3: POST /update-outlook = โหลด fastapn-outlook.ps1 ใหม่จาก Backend มาแทนตัวเก่าเอง (สำรอง .bak) -- MARKER_LISTENER_OUTLOOK_UPDATE_V1
$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 47831
$log = Join-Path $base 'fastapn-sp-listener.log'
function LLog($m) { try { "$(Get-Date -Format s) $m" | Out-File -FilePath $log -Append -Encoding utf8 } catch {} }
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\FastAPN_SP_Listener', [ref]$created)
if (-not $created) { exit 0 }
$allowed = New-Object System.Collections.Generic.List[string]
$allowed.Add('http://10.101.87.126:8081')
$allowFile = Join-Path $base 'fastapn-sp-listener.allow'
if (Test-Path -LiteralPath $allowFile) { foreach ($ln in (Get-Content -LiteralPath $allowFile -ErrorAction SilentlyContinue)) { $t = ([string]$ln).Trim(); if ($t -match '^https?://[A-Za-z0-9.:_-]+$') { $allowed.Add($t) } } }
$vbs = Join-Path $base 'fastapn-run-hidden.vbs'
$ps1 = Join-Path $base 'fastapn-sp.ps1'
$outlookPs1 = Join-Path $base 'fastapn-outlook.ps1'
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://127.0.0.1:$port/")
$l.Start()
LLog "listener v$ListenerVersion started on $port"
function Send-Json($res, [int]$code, [string]$json) {
  $res.StatusCode = $code
  $res.ContentType = 'application/json; charset=utf-8'
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
  $res.Close()
}
$quit = $false
while ($l.IsListening -and -not $quit) {
  $res = $null
  try {
    $c = $l.GetContext(); $req = $c.Request; $res = $c.Response
    $origin = [string]$req.Headers['Origin']
    if (-not $origin -or -not $allowed.Contains($origin)) { Send-Json $res 403 '{"ok":false,"error":"origin"}'; continue }
    $res.AddHeader('Access-Control-Allow-Origin', $origin)
    $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
    $res.AddHeader('Access-Control-Allow-Headers', '*')
    $res.AddHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    $res.AddHeader('Vary', 'Origin')
    if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; $res.Close(); continue }
    $path = $req.Url.AbsolutePath
    if ($path -eq '/ping') { Send-Json $res 200 ('{"ok":true,"listenerVersion":' + $ListenerVersion + '}'); continue }
    if ($path -eq '/quit' -and $req.HttpMethod -eq 'POST') { Send-Json $res 200 '{"ok":true}'; $quit = $true; continue }
    if ($path -eq '/run' -and $req.HttpMethod -eq 'POST') {
      $sr = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $uri = ([string]$sr.ReadToEnd()).Trim(); $sr.Close()
      $isSp = ($uri -match '^fastapn-sp://[A-Za-z]+'); $isOl = ($uri -match '^fastapn://')
      $maxLen = 8000; if ($isOl) { $maxLen = 30000 }
      if ($uri.Length -gt $maxLen -or (-not $isSp -and -not $isOl) -or $uri.Contains('"') -or ($isOl -and -not (Test-Path -LiteralPath $outlookPs1))) { Send-Json $res 400 '{"ok":false,"error":"uri"}'; continue }
      $target = $ps1; if ($isOl) { $target = $outlookPs1 }
      $argList = '//B //Nologo "' + $vbs + '" "' + $target + '" "' + $uri + '"'
      Start-Process -FilePath 'wscript.exe' -ArgumentList $argList
      Send-Json $res 200 '{"ok":true}'
      continue
    }
    if ($path -eq '/update-outlook' -and $req.HttpMethod -eq 'POST') {
      $sr = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $body = ([string]$sr.ReadToEnd()).Trim(); $sr.Close()
      $api = ''; $tok = ''
      foreach ($kv in $body.Split('&')) { $pp = $kv.Split('=', 2); if ($pp.Length -eq 2) { $v = [Uri]::UnescapeDataString($pp[1]); if ($pp[0] -eq 'api') { $api = $v } elseif ($pp[0] -eq 'token') { $tok = $v } } }
      if ($api -notmatch '^https?://[A-Za-z0-9.:_-]+$' -or $tok -notmatch '^[A-Za-z0-9._~+/=-]+$') { Send-Json $res 400 '{"ok":false,"error":"args"}'; continue }
      $tmp = $outlookPs1 + '.new'
      try {
        Invoke-WebRequest -Uri ($api + '/api/file-storage/outlook-handler/ps1-only') -Headers @{ Authorization = ('Bearer ' + $tok) } -OutFile $tmp -UseBasicParsing -TimeoutSec 30
        $txt = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
        if ((Get-Item -LiteralPath $tmp).Length -lt 2000 -or $txt -notmatch 'fastapn') { throw 'bad download' }
        if (Test-Path -LiteralPath $outlookPs1) { Copy-Item -LiteralPath $outlookPs1 -Destination ($outlookPs1 + '.bak') -Force }
        Move-Item -LiteralPath $tmp -Destination $outlookPs1 -Force
        LLog 'outlook ps1 updated'
        Send-Json $res 200 '{"ok":true}'
      } catch {
        LLog ('outlook update failed: ' + $_.Exception.Message)
        try { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } catch {}
        Send-Json $res 500 '{"ok":false,"error":"update"}'
      }
      continue
    }
    Send-Json $res 404 '{"ok":false}'
  } catch {
    LLog ("loop error: " + $_.Exception.Message)
    try { if ($res) { $res.Abort() } } catch {}
  }
}
try { $l.Stop() } catch {}
LLog 'listener stopped'
