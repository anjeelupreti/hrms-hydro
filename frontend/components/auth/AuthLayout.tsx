"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import ThemePopover from "@/components/shell/ThemePopover";
import ApartmentIcon from "@mui/icons-material/Apartment";
import DomainGlyph from "@/components/common/DomainGlyph";
import { DEPLOYMENT, PRODUCT_NAME } from "@/lib/product";

/**
 * The left-hand panel of the sign-in screen.
 *
 * **It names the company, not the product.** This build is installed for one
 * group and nobody outside it will ever see this screen — so the panel that
 * sold the software to a prospect is the wrong panel for the person who works
 * here and is signing in on a Sunday morning. What they need to know is that
 * they are at the right URL, and that is answered by the company's own name and
 * the four entities the group is actually made of.
 *
 * The illustrations stay: `DomainGlyph` draws a record with lines converging on
 * it, a timeline with a gap in it, a ladder of tax bands. Its own docstring
 * makes the case — "six stock illustrations of people pointing at charts say
 * nothing about what the software does" — and that argument holds whoever the
 * panel is addressed to.
 */
/** The four entities, with the glyph that suits each. A person signing in
 *  works for one of them and is paid by one of them; seeing the group laid out
 *  is how they know this is the system that holds their record. */
const GROUP = [
  { slug: "people", code: "VLUCL", label: "Vision Lumbini Urja", sub: "Holding company · Butwal, Rupandehi" },
  { slug: "money", code: "SNHL", label: "Seti Nadi Hydropower", sub: "25.0 MW · in operation · Kaski" },
  { slug: "time", code: "SJCL", label: "Sanjen Jalavidyut", sub: "42.5 MW · under construction · Rasuwa" },
  { slug: "growth", code: "MCTL", label: "Marsyangdi Corridor Transmission", sub: "Licensed · Lamjung" },
];

/** The terms payroll is actually run in here. Concrete, and the fastest way to
 *  say "made for this office" without a paragraph claiming it. */
const BUILT_IN = ["Bikram Sambat", "SSF", "Provident Fund", "CIT", "Nepali tax slabs", "TDS"];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", bgcolor: "background.default" }}>
      {/* ── Left: Branded Panel (Dim, Premium) ── */}
      <Box
        sx={{
          flex: "0 0 46%",
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "space-between",
          p: 6,
          color: "primary.contrastText",
          position: "relative",
          overflow: "hidden",
          background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
        }}
      >
        {/* Subtle dot grid decoration */}
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            opacity: 0.15,
            backgroundImage: (theme) => `radial-gradient(circle, ${theme.palette.primary.contrastText} 1px, transparent 1px)`,
            backgroundSize: "28px 28px",
          }}
        />

        {/* Ambient floating blobs */}
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.12)",
          }}
          animate={{ scale: [1, 1.15, 1], x: [0, 20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* The panel's own illustration, at the size of a poster rather than a
            bullet. One record with everything reading from it is the product's
            single idea, so it is the thing standing behind the words — in place
            of a blurred circle, which was decoration that could have belonged
            to anything. */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            bottom: -80,
            left: -70,
            opacity: 0.14,
            pointerEvents: "none",
            transform: "rotate(-8deg)",
          }}
        >
          <DomainGlyph slug="people" accent="#ffffff" size={420} />
        </Box>

        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                display: "grid",
                placeItems: "center",
                bgcolor: (theme) => alpha(theme.palette.primary.contrastText, 0.15),
                backdropFilter: "blur(4px)",
                border: "1px solid",
                borderColor: (theme) => alpha(theme.palette.primary.contrastText, 0.2),
              }}
            >
              <ApartmentIcon />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800, letterSpacing: 0.5 }}>
                {DEPLOYMENT.short}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {DEPLOYMENT.seat}
              </Typography>
            </Box>
          </Stack>
        </motion.div>

        <Stack spacing={4} sx={{ position: "relative", zIndex: 1 }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6 }}>
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1.1, mb: 1, maxWidth: 440 }}>
              {DEPLOYMENT.company}
            </Typography>
            <Typography sx={{ opacity: 0.8, maxWidth: 400, lineHeight: 1.45 }}>
              Human resources for the group — one record per person, read by
              payroll, attendance and leave alike.
            </Typography>
          </motion.div>
          <Stack spacing={2.5}>
            {GROUP.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.12, duration: 0.5 }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                  <Box
                    sx={{
                      width: 46,
                      height: 46,
                      borderRadius: 2.5,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: (theme) => alpha(theme.palette.primary.contrastText, 0.14),
                      border: "1px solid",
                      borderColor: (theme) => alpha(theme.palette.primary.contrastText, 0.18),
                      flexShrink: 0,
                    }}
                  >
                    <DomainGlyph slug={f.slug} accent="#ffffff" size={28} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                      <Typography sx={{ fontWeight: 700, fontSize: "1.02rem", lineHeight: 1.3 }}>
                        {f.label}
                      </Typography>
                      {/* The code, because that is what people say out loud and
                          what the memorandum numbers are built from. */}
                      <Typography
                        sx={{ fontSize: ".7rem", fontWeight: 700, opacity: 0.6, letterSpacing: ".06em" }}
                      >
                        {f.code}
                      </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: ".86rem", opacity: 0.75, lineHeight: 1.35 }}>
                      {f.sub}
                    </Typography>
                  </Box>
                </Stack>
              </motion.div>
            ))}
          </Stack>
        </Stack>

        {/* The proof, rather than a slogan. "Built for teams of every size" is
            a sentence any product could print; a row reading Bikram Sambat, SSF,
            CIT and Nepali tax slabs says something only one of them can. */}
        <Box sx={{ position: "relative", zIndex: 1 }}>
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 1, opacity: 0.55, fontWeight: 700, letterSpacing: ".08em" }}
          >
            BUILT IN THE TERMS PAYROLL IS ACTUALLY RUN IN HERE
          </Typography>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
            {BUILT_IN.map((term) => (
              <Box
                key={term}
                sx={{
                  px: 1,
                  py: 0.3,
                  borderRadius: 1,
                  fontSize: 11,
                  fontWeight: 600,
                  border: "1px solid",
                  borderColor: (theme) => alpha(theme.palette.primary.contrastText, 0.28),
                  opacity: 0.85,
                }}
              >
                {term}
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" sx={{ opacity: 0.55, fontWeight: 500 }}>
            © {new Date().getFullYear()} {DEPLOYMENT.company} · {PRODUCT_NAME}
          </Typography>
        </Box>
      </Box>

      {/* ── Right: Auth Forms ── */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: { xs: 3, sm: 6 },
          position: "relative",
          overflow: "hidden"
        }}
      >
        <Box sx={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}>
          <ThemePopover variant="icon" />
        </Box>
        
        {/* Subtle background decoration on mobile */}
        <Box
          sx={{
            position: "absolute",
            top: "-30%",
            right: "-20%",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: (theme) => `radial-gradient(circle, ${alpha(theme.palette.primary.main, 0.08)} 0%, transparent 70%)`,
            display: { xs: "block", md: "none" },
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          style={{ width: "100%", maxWidth: 440 }}
        >
          <Box
            // `applyStyles`, never `theme.palette.mode`. The theme is built
            // with `cssVariables` + `colorSchemes`, so `mode` stays whatever it
            // was at creation and never reports "dark" — a ternary on it renders
            // the light arm forever. `applyStyles` emits a rule under the dark
            // selector instead. Same rule as `HeroPanel`.
            sx={(theme) => ({
              bgcolor: "background.paper",
              borderRadius: 4,
              border: "1px solid",
              borderColor: "divider",
              p: { xs: 4, sm: 5 },
              boxShadow: `0 8px 40px ${alpha(theme.palette.primary.main, 0.08)}`,
              ...theme.applyStyles("dark", {
                boxShadow: `0 8px 40px ${alpha(theme.palette.common.black, 0.4)}`,
              }),
            })}
          >
            {children}
          </Box>
        </motion.div>
      </Box>
    </Box>
  );
}
