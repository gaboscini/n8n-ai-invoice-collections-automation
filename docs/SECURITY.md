# Security Notes

## Public repository controls

- Both workflows are inactive by default.
- No credential object or API key is included.
- Claude configuration uses an n8n Header Auth credential selected after import.
- External email delivery is intentionally replaced with a simulation.
- Operational alert delivery is intentionally replaced with a simulation.
- Simulated send requests are restricted to a fictional recipient domain.
- Error details are redacted before classification and alert construction.
- All included people, companies, addresses, and invoices are fictional.

## Reporting a problem

If a secret is accidentally committed, remove it from the provider first by revoking or rotating it. Rewriting Git history alone does not make a disclosed credential safe again.

## Not production-ready by default

This portfolio workflow demonstrates control design. It must not be connected to customer data or real delivery channels without the production-hardening items documented in `ARCHITECTURE.md`.
