# Flaire incident response

## Severity

| Level | Example | Response |
|---|---|---|
| Sev 1 | Money moved without a valid Flaire approval; issuer key or database compromised; ledger tampering detected | Kill switch for affected companies within 15 minutes, issuer key rotated, customer notified within 24 hours |
| Sev 2 | Account takeover of an approver; auth provider outage; backup failure for more than 48 hours | Session and token revocation for the user, root cause within 24 hours |
| Sev 3 | Degraded availability, delayed notifications, a bug in exports | Fix in the next release, status note to affected customers |

## First hour checklist

1. Contain: toggle the kill switch for affected companies (freezes every card at the issuer). If the issuer key may be exposed, rotate it in the Lithic dashboard and paste the new key in Settings, Payments.
2. Preserve: take a database backup (`python ops/backup.py backup`) before any cleanup. Export the audit ledger for the affected companies.
3. Revoke: for a suspected account takeover, reset the user's password (which revokes their connected AI clients), disable the user (status disabled), revoke connector tokens from Settings.
4. Verify integrity: run the audit verify endpoint for each affected company; compare against the last known good backup with `ops/backup.py verify`.
5. Communicate: open an incident channel, assign an incident lead, record a timeline.

## Notification

Confirmed breaches affecting customer data are reported to the customer's named security contact within 72 hours with: what happened, what data, what was done, what the customer should do. PDPL regulator notification follows the law in force at the time.

## After

Post-incident review within five working days: timeline, root cause, what control failed, what changes (code, policy or monitoring), owner and date for each.
