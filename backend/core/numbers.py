"""Numbers written out in words, Indic style.

A payslip states the net pay in words as well as figures — it is what makes a
transposed digit visible, and it is expected on any payslip here.

**Indic grouping, not Western.** After the first thousand the grouping goes
lakh (100,000) and crore (10,000,000), not million and billion. `1,50,000` reads
"one lakh fifty thousand", and a Western implementation would render it "one
hundred fifty thousand" — understood, but wrong on a Nepali document, and wrong
in a way that a reviewer checking against the figures would trip over.
"""

from decimal import Decimal

UNITS = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
)
TENS = (
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety",
)


def _under_thousand(value: int) -> str:
    """0–999, without a leading 'and'."""
    words = []
    if value >= 100:
        words.append(f"{UNITS[value // 100]} hundred")
        value %= 100
        if value:
            words.append("and")
    if value >= 20:
        words.append(TENS[value // 10])
        if value % 10:
            words.append(UNITS[value % 10])
    elif value:
        words.append(UNITS[value])
    return " ".join(words)


def number_to_words_indic(value) -> str:
    """`150000` → `"one lakh fifty thousand"`.

    Groups are emitted largest first: crore, lakh, thousand, then the final
    0–999. Each group above the last is itself under 100 except crore, which is
    open-ended — 100 crore is written "one hundred crore" rather than acquiring
    a new unit name, which is how it is actually said.
    """
    number = int(value)
    if number < 0:
        return f"minus {number_to_words_indic(-number)}"
    if number == 0:
        return "zero"

    parts = []
    crore, number = divmod(number, 10_000_000)
    lakh, number = divmod(number, 100_000)
    thousand, remainder = divmod(number, 1_000)

    if crore:
        # Recursive, not `_under_thousand`: crore is the open-ended group and
        # can itself run to lakhs and crores for absurd numbers.
        parts.append(f"{number_to_words_indic(crore)} crore")
    if lakh:
        parts.append(f"{_under_thousand(lakh)} lakh")
    if thousand:
        parts.append(f"{_under_thousand(thousand)} thousand")
    if remainder:
        parts.append(_under_thousand(remainder))
    return " ".join(parts)


def amount_to_words(amount, currency="Rupees", subunit="Paisa") -> str:
    """A money amount as it belongs on a payslip.

    Paisa are rendered separately rather than as a decimal, because "and fifty
    paisa" is the form that makes the figure checkable — which is the only
    reason the words are on the document at all.
    """
    quantised = Decimal(amount).quantize(Decimal("0.01"))
    whole = int(quantised)
    fraction = int((quantised - whole) * 100)

    words = f"{currency} {number_to_words_indic(whole)}"
    if fraction:
        words += f" and {subunit} {number_to_words_indic(fraction)}"
    return f"{words} only".replace("  ", " ")
