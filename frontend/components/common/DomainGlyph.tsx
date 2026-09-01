"use client";

/**
 * A drawn scene per domain, in place of an icon.
 *
 * **Why inline SVG rather than an illustration set.** Six stock illustrations
 * of people pointing at charts say nothing about what the software does, cost a
 * download each, and never match the palette. These draw the *shape of the
 * idea* — one record everything else reads from, a week with a gap in it, a
 * payslip whose every line is traceable — so the picture carries an argument
 * rather than decorating one.
 *
 * **Scenes, not marks.** Each is twelve to twenty elements composed to fill its
 * box, because an icon enlarged is not an illustration — three to five elements
 * read as an icon at 28px and as an empty frame at 148px, which is the same
 * amount of information with more space around it.
 *
 * At this density each one holds up as the dominant object on a card rather
 * than needing
 * text stacked under it to justify the room.
 *
 * **Two weights, on purpose.** `stroke` carries the subject; `faint` carries
 * the context it sits in. Everything at one weight is the reason a dense
 * drawing turns to mud — the eye needs to be told what the picture is *of*.
 *
 * **Every computed coordinate is rounded, and that is load-bearing.** ECMAScript
 * does not require `Math.sin`/`Math.cos` to be correctly rounded, so Node and
 * the browser are free to disagree in the last bit — which they did. The server
 * rendered `y1="32.67949192431123"` and the client computed
 * `32.679491924311236`, and React reported a hydration mismatch on the
 * homepage. The scenes below use literal coordinates wherever possible for the
 * same reason: a number that was never computed cannot disagree.
 */

export default function DomainGlyph({
  slug,
  accent,
  size = 72,
  animate = false,
}: {
  slug: string;
  accent: string;
  size?: number;
  animate?: boolean;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    fill: "none",
    // Decorative: the heading beside it already names the domain, so a label
    // here would make a screen reader say it twice.
    "aria-hidden": true as const,
  };
  /** The subject. */
  const stroke = {
    stroke: accent,
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  /** The context it sits in — half the weight, so the scene has a foreground. */
  const faint = { stroke: accent, strokeWidth: 1.4, opacity: 0.4 };
  /** Detail lines inside a shape: rows of a form, text on a card. */
  const hair = { stroke: accent, strokeWidth: 1.6, opacity: 0.55, strokeLinecap: "round" as const };
  const pulse = animate ? { className: "glyph-pulse" } : {};

  switch (slug) {
    /* One record, and everything else reading from it. */
    case "people":
      return (
        <svg {...common}>
          {/* The satellites first, so the record sits on top of its own lines. */}
          {[
            [20, 22],
            [80, 22],
            [16, 66],
            [84, 66],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <line x1={x} y1={y} x2="50" y2="50" {...faint} />
              <circle cx={x} cy={y - 4} r="4.5" {...stroke} />
              <path d={`M${x - 7} ${y + 6} a7 7 0 0 1 14 0`} {...stroke} />
            </g>
          ))}

          {/* The record itself: one card, with rows. */}
          <rect x="31" y="34" width="38" height="32" rx="4" fill="none" {...stroke} {...pulse} />
          <line x1="37" y1="43" x2="57" y2="43" {...hair} />
          <line x1="37" y1="50" x2="63" y2="50" {...hair} />
          <line x1="37" y1="57" x2="52" y2="57" {...hair} />

          {/* Confirmed — the record is the one everything agrees on. */}
          <circle cx="66" cy="63" r="7" fill={accent} opacity="0.14" />
          <path d="M62.5 63 l2.5 2.5 l4.5 -5" {...stroke} />
        </svg>
      );

    /* A week of work, and the day that does not add up. */
    case "time":
      return (
        <svg {...common}>
          <line x1="12" y1="74" x2="88" y2="74" {...faint} />

          {/* Five worked days and one that is missing its punch. */}
          {[
            [18, 46],
            [30, 38],
            [42, 52],
            [66, 34],
            [78, 44],
          ].map(([x, y]) => (
            <g key={x}>
              <rect x={x - 5} y={y} width="10" height={74 - y} rx="2.5" {...stroke} />
              <circle cx={x} cy={y - 5} r="2" fill={accent} opacity="0.7" />
            </g>
          ))}
          {/* The gap: drawn as an outline, because nothing was recorded. */}
          <rect
            x="49"
            y="50"
            width="10"
            height="24"
            rx="2.5"
            strokeDasharray="3 3"
            {...stroke}
            {...pulse}
          />

          {/* The clock the day is measured against. */}
          <circle cx="74" cy="20" r="12" {...faint} />
          <path d="M74 13 v7 l5 3" {...stroke} />

          {/* Approved, so payroll can read it. */}
          <path d="M16 86 l4 4 l8 -9" {...stroke} />
          <line x1="34" y1="86" x2="60" y2="86" {...hair} />
        </svg>
      );

    /* A payslip, and the bands the tax on it came out of. */
    case "money":
      return (
        <svg {...common}>
          {/* The sheet. */}
          <rect x="10" y="12" width="46" height="66" rx="4" {...stroke} />
          <line x1="17" y1="24" x2="40" y2="24" {...hair} />
          {/* Line items — each one traceable, which is the whole claim. */}
          {[34, 42, 50, 58].map((y) => (
            <g key={y}>
              <line x1="17" y1={y} x2="34" y2={y} {...hair} />
              <line x1="42" y1={y} x2="49" y2={y} {...faint} />
            </g>
          ))}
          {/* The total, ruled off. */}
          <line x1="17" y1="66" x2="49" y2="66" {...faint} />
          <line x1="30" y1="71" x2="49" y2="71" {...stroke} />

          {/* The slab ladder the deduction is computed from. */}
          {[
            [70, 62, 22],
            [70, 50, 17],
            [70, 38, 12],
            [70, 26, 7],
          ].map(([x, y, w]) => (
            <rect key={y} x={x} y={y} width={w} height="8" rx="2" {...stroke} opacity={0.45 + (62 - y) / 90} />
          ))}
          <line x1="66" y1="20" x2="66" y2="74" {...faint} />
          {/* Where this payslip lands on the ladder. */}
          <circle cx="82" cy="54" r="4.5" fill={accent} {...pulse} />
        </svg>
      );

    /* A hire becoming an employee, and the ladder they climb after. */
    case "growth":
      return (
        <svg {...common}>
          <line x1="12" y1="82" x2="88" y2="82" {...faint} />
          <line x1="12" y1="82" x2="12" y2="16" {...faint} />

          {/* The steps. */}
          <path d="M18 74 h16 v-14 h16 v-14 h16 v-14 h14" {...stroke} />

          {/* Candidates arriving, then one of them hired and rising. */}
          {[
            [22, 68],
            [40, 54],
            [58, 40],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="3.4" fill={accent} opacity="0.5" />
          ))}
          <circle cx="78" cy="26" r="6" {...stroke} {...pulse} />
          <path d="M75.5 26 l2 2 l4 -4.5" {...stroke} />

          {/* The review that follows, on the same record. */}
          <rect x="60" y="60" width="26" height="18" rx="3" {...faint} />
          <line x1="65" y1="67" x2="79" y2="67" {...hair} />
          <line x1="65" y1="72" x2="74" y2="72" {...hair} />
        </svg>
      );

    /* Messages, tickets and notices — on one directory. */
    case "comms":
      return (
        <svg {...common}>
          {/* The thread. */}
          <rect x="10" y="18" width="44" height="26" rx="6" {...stroke} />
          <path d="M20 44 v7 l9 -7" {...stroke} />
          <line x1="17" y1="27" x2="45" y2="27" {...hair} />
          <line x1="17" y1="35" x2="37" y2="35" {...hair} />

          <rect x="46" y="50" width="42" height="24" rx="6" {...stroke} opacity="0.8" {...pulse} />
          <line x1="53" y1="58" x2="79" y2="58" {...hair} />
          <line x1="53" y1="66" x2="70" y2="66" {...hair} />

          {/* One directory behind both — the same people, not a second list. */}
          {[
            [70, 22],
            [82, 30],
          ].map(([x, y]) => (
            <g key={x}>
              <circle cx={x} cy={y} r="4" {...stroke} />
              <path d={`M${x - 6} ${y + 10} a6 6 0 0 1 12 0`} {...faint} />
            </g>
          ))}

          {/* A ticket with a state, rather than "I raised it with someone". */}
          <rect x="12" y="62" width="24" height="16" rx="3" {...faint} />
          <circle cx="18" cy="70" r="2.4" fill={accent} opacity="0.75" />
          <line x1="24" y1="70" x2="31" y2="70" {...hair} />
        </svg>
      );

    /* Clients, the work done for them, and the invoice that follows. */
    case "business":
      return (
        <svg {...common}>
          {/* The board: three columns of work. */}
          {[14, 38, 62].map((x, column) => (
            <g key={x}>
              <line x1={x} y1="14" x2={x + 18} y2="14" {...faint} />
              {[20, 34, 48].slice(0, 3 - column).map((y) => (
                <rect key={y} x={x} y={y} width="18" height="10" rx="2.5" {...stroke} opacity={0.85} />
              ))}
            </g>
          ))}

          {/* The invoice it totals into. */}
          <rect x="52" y="52" width="34" height="34" rx="4" {...stroke} {...pulse} />
          {[62, 69].map((y) => (
            <g key={y}>
              <line x1="58" y1={y} x2="70" y2={y} {...hair} />
              <line x1="74" y1={y} x2="80" y2={y} {...faint} />
            </g>
          ))}
          <line x1="58" y1="76" x2="80" y2="76" {...faint} />
          <line x1="68" y1="81" x2="80" y2="81" {...stroke} />

          {/* Real people on the project, not names typed into a field. */}
          <circle cx="22" cy="70" r="4.5" {...stroke} />
          <path d="M15 82 a7 7 0 0 1 14 0" {...stroke} />
          <line x1="32" y1="72" x2="50" y2="66" {...faint} />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="30" {...stroke} />
        </svg>
      );
  }
}
