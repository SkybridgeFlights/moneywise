# Windows code signing

Electron Builder's normal Windows signing flow is enabled. No certificate or reusable password is stored in the repository.

## Release-runner configuration

1. Obtain an OV or EV Authenticode certificate from a trusted certificate authority.
2. Store the password-protected PFX and password in the release system's encrypted secret store.
3. Export `CSC_LINK` as a protected PFX path, base64 value, or supported secure URL.
4. Export `CSC_KEY_PASSWORD` as the PFX password.
5. Run `npm ci` followed by `npm run release:win` on Windows.

Electron Builder detects these variables automatically and signs the application executable, NSIS installer, uninstaller helper, and portable executable. `signAndEditExecutable` is not disabled. The strict verifier requires both variables and requires every published executable to report a valid Authenticode signature.

## Intentionally unsigned public releases

MoneyWise may be published without Authenticode signing only when all of these conditions are satisfied:

- the owner explicitly authorizes unsigned distribution for that release;
- release certification has passed and no confirmed Critical or High release blocker remains;
- the final artifact secret scan passes;
- SHA-256 checksums are generated for the exact published artifacts;
- the release notes and GitHub release clearly identify the Windows binaries as unsigned; and
- no statement implies that Windows has verified the publisher.

The authorized public-release verifier mode is separate from both signed-release verification and local unsigned validation:

```powershell
Remove-Item Env:CSC_LINK -ErrorAction SilentlyContinue
Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
npm.cmd run package:win
npm.cmd run release:verify:authorized-unsigned-public
```

This mode requires every distributable Windows executable to report `NotSigned`. It records `AUTHORIZED_UNSIGNED_PUBLIC_RELEASE`; it does not bypass, simulate, or claim a valid Authenticode signature.

## Unsigned validation builds

Local unsigned builds remain supported:

```powershell
Remove-Item Env:CSC_LINK -ErrorAction SilentlyContinue
Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
npm.cmd run package:win
npm.cmd run release:verify:unsigned
```

The generic unsigned-validation mode is for local testing only. It does not authorize publication.

## Certificate verification

```powershell
Get-AuthenticodeSignature 'release\MoneyWise Setup 1.0.0.exe'
Get-AuthenticodeSignature 'release\MoneyWise 1.0.0.exe'
```

For a signed release, both statuses must be `Valid`. Verify the publisher subject, timestamp, SHA-256 digest, and certificate chain. Retain the release validation JSON, checksums, commit ID, runner identity, and certificate thumbprint with release provenance. The authorized-unsigned policy does not weaken these requirements for a release represented as signed.

If signing fails, do not weaken the gate. Check certificate expiration, password, hardware-token availability, timestamp service, and runner permissions.
