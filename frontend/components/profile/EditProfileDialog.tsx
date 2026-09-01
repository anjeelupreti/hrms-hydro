"use client";

import UploadFileIcon from "@mui/icons-material/UploadFile";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import DateField from "@/components/common/DateField";
import ImageUpload from "@/components/common/ImageUpload";
import CoverPositioner from "@/components/profile/CoverPositioner";
import { useUpdateProfile, type MyProfile } from "@/hooks/useProfile";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export default function EditProfileDialog({ profile, onClose }: { profile: MyProfile; onClose: () => void }) {
  const updateProfile = useUpdateProfile();
  const [firstName, setFirstName] = useState(profile.first_name);
  const [lastName, setLastName] = useState(profile.last_name);
  const [phone, setPhone] = useState(profile.phone);
  const [dob, setDob] = useState(profile.date_of_birth ?? "");
  const [gender, setGender] = useState(profile.gender);
  const [bio, setBio] = useState(profile.bio);
  const [address, setAddress] = useState(profile.address);
  const [city, setCity] = useState(profile.city);
  const [country, setCountry] = useState(profile.country);
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [photo, setPhoto] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPosition, setCoverPosition] = useState(profile.cover_position ?? "50% 50%");
  /**
   * A local preview of a freshly-chosen file, so the positioner shows the photo
   * being uploaded rather than the one being replaced. Revoked on unmount —
   * object URLs leak until the document goes away otherwise.
   */
  const coverPreview = useMemo(
    () => (cover ? URL.createObjectURL(cover) : null),
    [cover],
  );
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const form = new FormData();
    form.append("first_name", firstName);
    form.append("last_name", lastName);
    form.append("phone", phone);
    if (dob) form.append("date_of_birth", dob);
    form.append("gender", gender);
    form.append("bio", bio);
    form.append("address", address);
    form.append("city", city);
    form.append("country", country);
    form.append("skills", JSON.stringify(skills));
    if (photo) form.append("photo", photo);
    if (cover) form.append("cover_image", cover);
    // Sent whether or not the file changed: somebody re-cropping an existing
    // cover has no new file, and the position is the whole edit.
    form.append("cover_position", coverPosition);
    if (resume) form.append("resume", resume);
    try {
      await updateProfile.mutateAsync(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit profile</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Profile photo
            </Typography>
            <ImageUpload value={profile.photo} fallback={initials(profile.full_name)} label="Change photo" onChange={setPhoto} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Cover image
            </Typography>
            <ImageUpload value={profile.cover_image} shape="square" size={64} label="Change cover" onChange={setCover} />
          </Box>

          {/* Only once there is something to position. An empty 13:1 frame
              inviting a drag is a control over nothing. */}
          {coverPreview || profile.cover_image ? (
            <CoverPositioner
              image={coverPreview ?? (profile.cover_image as string)}
              value={coverPosition}
              onChange={setCoverPosition}
            />
          ) : null}

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Résumé / CV
            </Typography>
            <Button component="label" variant="outlined" size="small" startIcon={<UploadFileIcon />}>
              {resume ? resume.name : profile.resume ? "Replace CV" : "Upload CV"}
              <input hidden type="file" accept=".pdf,.doc,.docx" onChange={(e) => setResume(e.target.files?.[0] ?? null)} />
            </Button>
          </Box>

          <Divider />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="First name" fullWidth value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <TextField label="Last name" fullWidth value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Stack>
          <TextField label="Bio" fullWidth multiline minRows={2} value={bio} onChange={(e) => setBio(e.target.value)} />
          <TextField label="Phone" fullWidth value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={skills}
            onChange={(_, v) => setSkills(v as string[])}
            renderValue={(value: readonly string[], getItemProps) =>
              value.map((option, index) => {
                const { key, ...rest } = getItemProps({ index });
                return <Chip key={key} label={option} size="small" {...rest} />;
              })
            }
            renderInput={(params) => <TextField {...params} label="Skills" placeholder="Type and press Enter" />}
          />
          <TextField label="Address" fullWidth value={address} onChange={(e) => setAddress(e.target.value)} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="City" fullWidth value={city} onChange={(e) => setCity(e.target.value)} />
            <TextField label="Country" fullWidth value={country} onChange={(e) => setCountry(e.target.value)} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <DateField label="Date of birth" value={dob} onChange={setDob} />
            <TextField select label="Gender" fullWidth value={gender} onChange={(e) => setGender(e.target.value)}>
              <MenuItem value="">—</MenuItem>
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={updateProfile.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
