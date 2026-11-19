import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      className="w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-2 p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-3">
        <Button variant="ghost" size="sm" onClick={onCancel} autoFocus>{cancelLabel}</Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
