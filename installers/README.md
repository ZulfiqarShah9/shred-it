# Installers

Download the latest installers from the [GitHub Releases page](https://github.com/ZulfiqarShah9/shred-it/releases/tag/v1.0.0).

- `Shred-it-1.0.0-universal.dmg` — macOS, Intel + Apple Silicon
- `Shred-it Setup 1.0.0.exe` — Windows x64

This folder also contains local copies of both installers for offline reinstall. Large binaries are intentionally ignored by Git; release assets are the canonical download source.

Verify a download on macOS/Linux with:

```bash
shasum -a 256 Shred-it-1.0.0-universal.dmg
```

or on Windows PowerShell:

```powershell
Get-FileHash "Shred-it Setup 1.0.0.exe" -Algorithm SHA256
```

Expected hashes are in `SHA256SUMS.txt`.
