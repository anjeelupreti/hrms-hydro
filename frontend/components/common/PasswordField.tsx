"use client";

import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";

/**
 * A password box you can look inside.
 *
 * **Why it matters more here than it looks.** Every password in this system is
 * typed by somebody who cannot see what they are typing — on a site laptop, on
 * a phone, with a generated first-login password they were handed on paper. The
 * usual result is three failed attempts and a call to HR, and the account locks
 * itself out for a reason that was never a security question.
 *
 * Hidden by default, because a password left visible on a shared screen is the
 * failure this control exists to balance against. Revealing is deliberate,
 * one-way per field, and resets the moment the component unmounts — there is no
 * "remember that I showed it".
 *
 * **One component, every password box.** There were eight `type="password"`
 * fields across login, the first-password gate, settings, the reset flow and
 * the mail configuration, and adding an eye to one of them is how a product
 * ends up with the affordance on the screen people complained about and nowhere
 * else. Everything else is `TextField`'s own API, so a caller keeps whatever it
 * was already passing.
 */
export default function PasswordField({
  label = "Password",
  startIcon,
  ...props
}: Omit<TextFieldProps, "type"> & {
  /** An icon in front of the field, to match a username box beside it. */
  startIcon?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);

  return (
    <TextField
      {...props}
      label={label}
      type={shown ? "text" : "password"}
      slotProps={{
        ...props.slotProps,
        input: {
          ...(props.slotProps?.input as object),
          startAdornment: startIcon ? (
            <InputAdornment position="start">{startIcon}</InputAdornment>
          ) : undefined,
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={shown ? "Hide password" : "Show password"}>
                <IconButton
                  // `aria-label` rather than a title alone: a screen reader
                  // announces the button, and "show password" is the whole
                  // meaning of an eye.
                  aria-label={shown ? "Hide password" : "Show password"}
                  onClick={() => setShown((was) => !was)}
                  // Kept out of the tab order. Somebody tabbing from the
                  // password box expects the submit button, not a toggle, and
                  // the mouse is how this control is actually reached.
                  tabIndex={-1}
                  // A mousedown here would blur the field and, in Safari, move
                  // the caret to the end of what has been typed so far.
                  onMouseDown={(event) => event.preventDefault()}
                  edge="end"
                  size="small"
                >
                  {shown ? (
                    <VisibilityOffIcon fontSize="small" />
                  ) : (
                    <VisibilityIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
