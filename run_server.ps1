# Krishi Seva Local Server & Browser Launcher
param(
  [int]$Port = 8080
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   Krishi Seva (कृषि सेवा) Web Portal Launcher" -ForegroundColor Yellow
Write-Host "   SIH Problem Statement 26032 - Mandi Queue & MSP" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Serving files from: $scriptDir"
Write-Host "Server URL: http://localhost:$Port"
Write-Host "Press Ctrl+C to terminate the server anytime."
Write-Host ""

# Launch Browser
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (Test-Path $edgePath) {
    Start-Process $edgePath "http://localhost:$Port/index.html"
} else {
    Start-Process "http://localhost:$Port/index.html"
}

# Start Lightweight HTTP Listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Warning "Could not bind port $Port. Opening file directly in Microsoft Edge instead..."
    if (Test-Path $edgePath) {
        Start-Process $edgePath "$scriptDir\index.html"
    } else {
        Start-Process "$scriptDir\index.html"
    }
    Exit
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $localPath = $request.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($localPath)) {
        $localPath = "index.html"
    }
    $filePath = Join-Path $scriptDir $localPath

    if (Test-Path $filePath -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()

        switch ($ext) {
            ".html" { $response.ContentType = "text/html; charset=utf-8" }
            ".css"  { $response.ContentType = "text/css" }
            ".js"   { $response.ContentType = "application/javascript" }
            ".json" { $response.ContentType = "application/json" }
            ".png"  { $response.ContentType = "image/png" }
            ".jpg"  { $response.ContentType = "image/jpeg" }
            ".svg"  { $response.ContentType = "image/svg+xml" }
            default { $response.ContentType = "application/octet-stream" }
        }

        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - File Not Found")
        $response.OutputStream.Write($msg, 0, $msg.Length)
    }

    $response.OutputStream.Close()
}
