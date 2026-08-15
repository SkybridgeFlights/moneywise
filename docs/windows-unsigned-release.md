# Installing the free unsigned Windows release

MoneyWise is currently distributed free of charge. Its Windows installer and portable executable are not currently signed with an Authenticode publisher certificate.

Windows SmartScreen or an **Unknown Publisher** message may therefore appear. This warning means Windows cannot verify the software publisher through Authenticode; it does not mean that Windows has verified MoneyWise under another identity.

Download MoneyWise only from the official MoneyWise GitHub release designated by this project. Each release publishes SHA-256 checksums so you can verify that a downloaded file matches the artifact published by the project.

If Windows presents its normal user-controlled option to continue with an unsigned application, review the displayed filename and the published checksum before deciding whether to proceed. Do not disable Windows Defender, SmartScreen, antivirus software, or other operating-system protections globally.
