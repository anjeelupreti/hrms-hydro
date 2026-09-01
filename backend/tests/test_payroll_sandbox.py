"""P1.1.1 / P1.1.2 — the formula sandbox and evaluation order.

A company HR admin can type a formula into a salary component and it is
evaluated on our server. That makes `_eval_formula` the most security-
sensitive line in the product: it is remote code execution by design, and
the only thing standing between "configurable payroll" and "shell access"
is what `simpleeval` refuses to do.

These tests pin that boundary. They also pin the *arithmetic* boundary —
which component can see which other component — because a formula that
silently reads zero is a wrong payslip that nobody notices.
"""

from decimal import Decimal

import pytest
from simpleeval import (
    FeatureNotAvailable,
    FunctionNotDefined,
    IterableTooLong,
    NumberTooHigh,
)

from payroll.services import PayrollConfigurationError, _eval_formula

# No django_db mark: _eval_formula is a pure function over a dict. Keeping
# these off the database makes the most security-sensitive tests in the suite
# also the fastest ones, so there is no excuse to skip them.


CONTEXT = {"basic": Decimal("50000"), "hra": Decimal("20000")}


# ── P1.1.1a — the sandbox cannot be escaped ──────────────────────────────


@pytest.mark.parametrize(
    "formula",
    [
        "__import__('os').system('echo pwned')",
        "().__class__.__bases__[0].__subclasses__()",
        "basic.__class__",
        "open('/etc/passwd').read()",
        "eval('1+1')",
        "exec('x=1')",
        "globals()",
        "locals()",
        "compile('1', '<s>', 'eval')",
        "getattr(basic, 'real')",
    ],
)
def test_formula_cannot_escape_the_sandbox(formula):
    """Every one of these is a documented Python-eval escape. None may run.

    We assert only that it *raises* — not which exception — because the
    guarantee we care about is 'refused', and simpleeval draws the line in
    different places for attribute access vs undefined functions.
    """
    with pytest.raises(Exception) as exc:
        _eval_formula(formula, CONTEXT)

    # A SyntaxError or a plain ValueError would suggest it got far enough to
    # try; these are the refusal types we expect from a sandbox doing its job.
    assert exc.type.__name__ != "SystemExit"


def test_attribute_access_is_refused():
    with pytest.raises(FeatureNotAvailable):
        _eval_formula("basic.__class__", CONTEXT)


def test_undefined_function_is_refused():
    with pytest.raises(FunctionNotDefined):
        _eval_formula("__import__('os')", CONTEXT)


def test_arithmetic_still_works():
    """The sandbox is worthless if it also blocks the legitimate use."""
    assert _eval_formula("basic * 0.1 + hra / 2", CONTEXT) == Decimal("15000.00")


# ── P1.1.1b — an unknown reference fails loudly ──────────────────────────


def test_formula_referencing_an_unknown_component_raises():
    """The dangerous alternative is silently treating it as zero, which
    produces a plausible-looking payslip that is quietly wrong.

    **Now a `PayrollConfigurationError` rather than simpleeval's own
    `NameNotDefined` (D‑12).** Both are loud; only one is loud where it helps.
    `compute_employee_payslip` catches `PayrollConfigurationError` and records
    it against the employee, so the run names who failed and `finalize` blocks
    until it is fixed. `NameNotDefined` escaped that handler, failed the chord,
    and left the whole run at PROCESSING with the reason visible only in
    Sentry — where the person who can fix a salary structure is not looking.

    Security refusals are *not* translated: `__class__`, `__import__` and the
    bombs below still raise simpleeval's own exceptions, because an attempted
    escape must not be filed as somebody's typo.
    """
    with pytest.raises(PayrollConfigurationError) as exc:
        _eval_formula("basic + does_not_exist", CONTEXT)
    # The message names the missing component, which is the thing to go fix.
    assert "does_not_exist" in str(exc.value)


def test_formula_referencing_a_later_component_raises():
    """Ordering is enforced by *absence*: a component computed later simply
    isn't in the context yet, so referencing it is the same failure as
    referencing something that doesn't exist. That is the behaviour we want
    — loud, not zero."""
    with pytest.raises(PayrollConfigurationError):
        _eval_formula("tax * 2", CONTEXT)  # `tax` is computed after this


# ── P1.1.1c — pathological input is bounded ──────────────────────────────


def test_exponentiation_bomb_is_refused():
    """`9**9**9` is the classic eval bomb — it would pin a CPU for minutes
    and allocate gigabytes. simpleeval caps the exponent."""
    with pytest.raises(NumberTooHigh):
        _eval_formula("9**9**9", CONTEXT)


def test_string_multiplication_bomb_is_refused():
    """Allocating a 100 MB string per payslip is a denial-of-service with a
    one-line formula. simpleeval caps iterable length."""
    with pytest.raises(IterableTooLong):
        _eval_formula("'x' * 100000000", CONTEXT)


# ── Numeric fidelity ─────────────────────────────────────────────────────


def test_result_is_quantized_to_two_places():
    """Money is two decimal places. The engine converts to float internally
    for simpleeval, so this also guards the round-trip back to Decimal."""
    result = _eval_formula("basic / 3", CONTEXT)

    assert result == Decimal("16666.67")
    assert result.as_tuple().exponent == -2


def test_half_up_rounding_not_bankers_rounding():
    """Python's round() is banker's rounding — 0.5 goes to the even digit.
    Payroll convention is half-up, and _quantize sets ROUND_HALF_UP. If
    someone swaps that out, this catches it."""
    assert _eval_formula("2.005 * 1000", {}) == Decimal("2005.00")
    assert _eval_formula("0.125", {}) == Decimal("0.13")
