# Rebuild native icon formats from the approved PNG on Windows.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$buildDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../build'))
$iconsDirectory = Join-Path $buildDirectory 'icons'
[IO.Directory]::CreateDirectory($iconsDirectory) | Out-Null
$source = [Drawing.Image]::FromFile((Join-Path $buildDirectory 'icon.png'))
$images = @{}
try {
    foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512, 1024)) {
        $bitmap = New-Object Drawing.Bitmap($size, $size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $stream = New-Object IO.MemoryStream
        try {
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, 0, 0, $size, $size)
            $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
            $images[$size] = $stream.ToArray()
            if ($size -le 512) {
                [IO.File]::WriteAllBytes((Join-Path $iconsDirectory "${size}x${size}.png"), $images[$size])
            }
        } finally {
            $stream.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $source.Dispose()
}

# ICO directory entries reference PNG frames, preserving the source alpha.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$ico = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter($ico)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    foreach ($size in $sizes) {
        $dimension = if ($size -eq 256) { 0 } else { $size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$size].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$size].Length
    }
    foreach ($size in $sizes) { $writer.Write([byte[]]$images[$size]) }
    [IO.File]::WriteAllBytes((Join-Path $buildDirectory 'icon.ico'), $ico.ToArray())
} finally {
    $writer.Dispose()
    $ico.Dispose()
}

# ICNS uses big-endian chunk lengths and PNG representations up to 1024px.
function Write-BigEndian([IO.BinaryWriter]$Writer, [uint32]$Value) {
    $bytes = [BitConverter]::GetBytes($Value)
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($bytes) }
    $Writer.Write($bytes)
}
$types = [ordered]@{ icp4 = 16; icp5 = 32; icp6 = 64; ic07 = 128; ic08 = 256; ic09 = 512; ic10 = 1024 }
$totalLength = 8
foreach ($size in $types.Values) { $totalLength += 8 + $images[$size].Length }
$icns = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter($icns)
try {
    $writer.Write([Text.Encoding]::ASCII.GetBytes('icns'))
    Write-BigEndian $writer $totalLength
    foreach ($entry in $types.GetEnumerator()) {
        $writer.Write([Text.Encoding]::ASCII.GetBytes($entry.Key))
        Write-BigEndian $writer (8 + $images[$entry.Value].Length)
        $writer.Write([byte[]]$images[$entry.Value])
    }
    [IO.File]::WriteAllBytes((Join-Path $buildDirectory 'icon.icns'), $icns.ToArray())
} finally {
    $writer.Dispose()
    $icns.Dispose()
}
Write-Output 'Generated Windows ICO, macOS ICNS and Linux PNG icons in build/.'
