# Security Policy

Effective date: February 11, 2026

## Reporting a Vulnerability

Please report security issues by emailing **support@sofull.site** with:

- A clear description of the issue and impact.
- Steps to reproduce (including any proof-of-concept).
- Affected URLs, endpoints, or versions.

We will acknowledge reports and work on a fix as quickly as possible. Please do not publicly disclose issues until we confirm a resolution.

## Supported Versions

Only the latest production release is supported. Older builds may not receive security updates.

## Security Practices

- Keep secrets server-side only; never bundle or commit them.
- Use non-secret client environment variables only.
- Avoid logging tokens or sensitive data.
- Restrict CORS to known origins.
- Rate limit sensitive endpoints.

## If You Suspect a Leak

1. Revoke and rotate exposed credentials.
2. Review deployments, logs, and Git history for exposure.
3. Redeploy to ensure new secrets are in use.
4. If needed, invalidate user sessions.
