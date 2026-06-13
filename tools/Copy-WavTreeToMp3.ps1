<#
.SYNOPSIS
    Kopiert einen Verzeichnisbaum und konvertiert alle WAV-Dateien zu MP3.

.DESCRIPTION
    Erstellt einen neuen Verzeichnisbaum unter <Ziel>, wobei die Struktur
    aus <Quelle> 1:1 übernommen wird. WAV-Dateien werden via ffmpeg zu MP3
    konvertiert. Alle anderen Dateien werden standardmäßig ignoriert
    (siehe -CopyOthers).

    Voraussetzung: ffmpeg muss im PATH sein.
      winget install ffmpeg
      oder: https://ffmpeg.org/download.html

.PARAMETER Source
    Quell-Verzeichnis (Root des WAV-Baums).

.PARAMETER Destination
    Ziel-Verzeichnis (neuer Root-Name für den MP3-Baum).

.PARAMETER Bitrate
    MP3-Bitrate, z. B. 128k, 192k, 320k. Standard: 192k

.PARAMETER CopyOthers
    Auch Nicht-WAV-Dateien in den Zielbaum kopieren.

.PARAMETER DryRun
    Nur anzeigen was passieren würde, nichts wirklich ausführen.

.EXAMPLE
    .\Copy-WavTreeToMp3.ps1 -Source "D:\Projekt_WAV" -Destination "D:\Projekt_MP3"

.EXAMPLE
    .\Copy-WavTreeToMp3.ps1 -Source ".\mein_projekt" -Destination ".\mein_projekt_mp3" -Bitrate 320k -CopyOthers

.EXAMPLE
    .\Copy-WavTreeToMp3.ps1 -Source ".\mein_projekt" -Destination ".\mein_projekt_mp3" -DryRun
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [string] $Source,

    [Parameter(Mandatory, Position = 1)]
    [string] $Destination,

    [string] $Bitrate = "192k",

    [switch] $CopyOthers,

    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

function Test-Ffmpeg {
    try {
        $null = & ffmpeg -version 2>&1
        return $true
    } catch {
        return $false
    }
}

function Convert-WavToMp3 {
    param(
        [string] $SrcFile,
        [string] $DstFile,
        [string] $Bitrate,
        [bool]   $DryRun
    )

    if ($DryRun) {
        Write-Host "  [DRY-RUN] WAV -> MP3 : $SrcFile  ->  $DstFile" -ForegroundColor Cyan
        return $true
    }

    $null = New-Item -ItemType Directory -Path (Split-Path $DstFile) -Force

    # Pfade in Anführungszeichen einschließen (wichtig bei Leerzeichen im Pfad)
    $ffmpegArgs = "-y -i `"$SrcFile`" -codec:a libmp3lame -b:a $Bitrate -map_metadata 0 `"$DstFile`""

    $proc = Start-Process -FilePath "ffmpeg" `
                          -ArgumentList $ffmpegArgs `
                          -NoNewWindow `
                          -Wait `
                          -PassThru `
                          -RedirectStandardError "$env:TEMP\ffmpeg_err.txt"

    if ($proc.ExitCode -ne 0) {
        $errText = Get-Content "$env:TEMP\ffmpeg_err.txt" -Tail 1 -ErrorAction SilentlyContinue
        Write-Warning "  [FEHLER] $(Split-Path $SrcFile -Leaf): $errText"
        return $false
    }
    return $true
}

# ---------------------------------------------------------------------------
# Validierung
# ---------------------------------------------------------------------------

$srcRoot = (Resolve-Path $Source -ErrorAction SilentlyContinue)?.Path
if (-not $srcRoot -or -not (Test-Path $srcRoot -PathType Container)) {
    Write-Error "Quellverzeichnis nicht gefunden: $Source"
    exit 1
}

$dstRoot = [System.IO.Path]::GetFullPath($Destination)

if ((Test-Path $dstRoot) -and (Get-ChildItem $dstRoot -Force | Select-Object -First 1)) {
    Write-Warning "Zielverzeichnis existiert und ist nicht leer: $dstRoot"
    $antwort = Read-Host "Trotzdem fortfahren? (j/N)"
    if ($antwort -notmatch '^[jJyY]') {
        Write-Host "Abgebrochen."
        exit 0
    }
}

if (-not (Test-Ffmpeg)) {
    Write-Error @"
ffmpeg nicht gefunden. Bitte installieren:
  winget install ffmpeg
  oder: https://ffmpeg.org/download.html
"@
    exit 1
}

# ---------------------------------------------------------------------------
# Hauptlauf
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Quelle      : $srcRoot"
Write-Host "Ziel        : $dstRoot"
Write-Host "Bitrate     : $Bitrate"
Write-Host "CopyOthers  : $(if ($CopyOthers) { 'ja' } else { 'nein (nur WAV-Dateien)' })"
Write-Host "Dry-Run     : $(if ($DryRun) { 'ja' } else { 'nein' })"
Write-Host ("-" * 60)

$converted = 0
$copied    = 0
$skipped   = 0
$errors    = 0

Get-ChildItem -Path $srcRoot -Recurse -File | ForEach-Object {
    $file    = $_
    $relPath = $file.FullName.Substring($srcRoot.Length).TrimStart('\','/')
    $relDir  = Split-Path $relPath -Parent

    $dstDir  = if ($relDir) { Join-Path $dstRoot $relDir } else { $dstRoot }

    if ($file.Extension -ieq ".wav") {
        $dstBaseName = $file.BaseName -replace '^EV_', 'VG_'
        $dstFile = Join-Path $dstDir ($dstBaseName + ".mp3")
        Write-Host "  WAV -> MP3 : $relPath" -ForegroundColor Green

        $ok = Convert-WavToMp3 -SrcFile $file.FullName `
                                -DstFile $dstFile `
                                -Bitrate $Bitrate `
                                -DryRun $DryRun.IsPresent
        if ($ok) { $converted++ } else { $errors++ }

    } elseif ($CopyOthers) {
        $dstFile = Join-Path $dstDir $file.Name
        Write-Host "  Kopieren   : $relPath" -ForegroundColor Yellow

        if (-not $DryRun) {
            $null = New-Item -ItemType Directory -Path $dstDir -Force
            Copy-Item -Path $file.FullName -Destination $dstFile -Force
        } else {
            Write-Host "  [DRY-RUN] Kopiere: $($file.FullName)  ->  $dstFile" -ForegroundColor Cyan
        }
        $copied++

    } else {
        $skipped++
    }
}

# Leere Unterverzeichnisse anlegen (auch wenn sie keine WAVs enthalten)
Get-ChildItem -Path $srcRoot -Recurse -Directory | ForEach-Object {
    $relDir  = $_.FullName.Substring($srcRoot.Length).TrimStart('\','/')
    $dstDir  = Join-Path $dstRoot $relDir
    if (-not (Test-Path $dstDir)) {
        if (-not $DryRun) {
            $null = New-Item -ItemType Directory -Path $dstDir -Force
        } else {
            Write-Host "[DRY-RUN] Erstelle Verzeichnis: $dstDir" -ForegroundColor Cyan
        }
    }
}

# ---------------------------------------------------------------------------
# Zusammenfassung
# ---------------------------------------------------------------------------

Write-Host ("-" * 60)
Write-Host "Fertig."
Write-Host "  Konvertiert : $converted WAV -> MP3"
if ($CopyOthers) {
    Write-Host "  Kopiert     : $copied sonstige Dateien"
}
Write-Host "  Übersprungen: $skipped Dateien"
if ($errors -gt 0) {
    Write-Warning "  Fehler      : $errors Dateien konnten nicht konvertiert werden"
    exit 1
}
