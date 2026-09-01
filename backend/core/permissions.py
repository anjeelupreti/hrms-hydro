"""Cross-cutting DRF permissions.

Role- and capability-based checks live in `accounts.permissions`, which asks
`accounts.policy` — the one place that decides who may do what.
""" 