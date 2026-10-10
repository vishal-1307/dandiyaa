# Legacy design reference — not a deployment root

The repository root is the sole maintained application. The copied backend has
been removed from this static directory to prevent source and credential exposure.
Frontend reference files are synchronized from the canonical root for comparison.
Do not publish this directory as a ticketing application: static hosting cannot run
the authenticated payment backend. See the root README and CODEX_SECURITY_AUDIT.md.
