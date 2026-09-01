"use client";

import { useState } from "react";
import { Box, Button, TextField, Stack, MenuItem } from "@mui/material";
import DateField from "@/components/common/DateField";
import { useModalStore } from "@/hooks/useModalStore";
import { useCreateExpenseClaim } from "@/hooks/useExpenses";
import { todayIso } from "@/lib/format/period";

const CATEGORIES = [
  { value: "travel", label: "Travel" },
  { value: "meals", label: "Meals" },
  { value: "supplies", label: "Supplies" },
  { value: "software", label: "Software" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" }
];

export default function ExpenseClaimModal() {
  const { closeDrawer } = useModalStore();
  const create = useCreateExpenseClaim();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");

  async function handleSubmit() {
    if (!title || !amount || !date) return;
    
    const formData = new FormData();
    formData.append("title", title);
    formData.append("category", category);
    formData.append("amount", amount);
    formData.append("expense_date", date);
    formData.append("description", description);

    // The mutation accepts a FormData body (there's a receipt file on it),
    // which its parameter type doesn't spell out.
    await create.mutateAsync(formData as unknown as Parameters<typeof create.mutateAsync>[0]);
    closeDrawer();
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ flex: 1 }}>
        <Stack spacing={3}>
          <TextField 
            label="Title" 
            value={title} 
            onChange={e => setTitle(e.target.value)} 
            fullWidth 
            required
          />
          <Stack direction="row" spacing={2}>
            <TextField 
              select 
              label="Category" 
              value={category} 
              onChange={e => setCategory(e.target.value)} 
              fullWidth
            >
              {CATEGORIES.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
            </TextField>
            <TextField 
              label="Amount" 
              type="number" 
              value={amount} 
              onChange={e => setAmount(e.target.value)} 
              fullWidth 
              required
            />
          </Stack>
          <DateField label="Expense Date" value={date} onChange={setDate} required />
          <TextField 
            label="Description (Optional)" 
            multiline 
            rows={4} 
            value={description} 
            onChange={e => setDescription(e.target.value)} 
            fullWidth 
          />
        </Stack>
      </Box>
      <Box sx={{ pt: 3, mt: 3, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button onClick={closeDrawer}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={create.isPending || !title || !amount || !date}>
          Submit Claim
        </Button>
      </Box>
    </Box>
  );
}
