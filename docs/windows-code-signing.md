# Windows code signing

MoneyWise does not include or fabricate a signing certificate. Electron Builder will sign the installer and portable executable when release automation supplies a trusted code-signing identity.

1. Obtain an organization-validation or extended-validation Authenticode certificate from a trusted certificate authority.
2. Store a password-protected PFX in the release system's encrypted secret store; never commit it.
3. Set `CSC_LINK` to the secure PFX path or protected base64/HTTPS secret reference and `CSC_KEY_PASSWORD` to its password for the packaging job.
4. Run `npm ci` and `npm run package:win` on the controlled Windows release runner.
5. Verify both generated executables with `Get-AuthenticodeSignature` and require `Status = Valid` before publishing.
6. Timestamp signatures using the certificate authority's RFC 3161 timestamp service and retain the build provenance and SHA-256 checksums.

Unsigned local development packages are expected. Public distribution is blocked until the signing verification gate is enabled with the real certificate.
