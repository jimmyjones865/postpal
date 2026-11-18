import * as React from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<"input">, "type" | "onChange"> & { onCheckedChange?: (checked: boolean) => void };

export function Checkbox({ className, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn("h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50", className)}
      onChange={e => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  );
}
