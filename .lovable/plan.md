
# Plan: Dependency Cleanup, Code Refactoring, Dark Theme, and Sonner-Only Toasts

## Overview
This plan addresses four main goals:
1. Remove unused dependencies (including `lovable-tagger`)
2. Delete unused UI component files
3. Hardcode dark theme (remove `next-themes` dependency)
4. Keep only Sonner for toast notifications (remove Radix toast system)

---

## Part 1: Dependency Removal

### Dependencies to REMOVE

| Package | Reason |
|---------|--------|
| `lovable-tagger` (dev) | Explicitly requested |
| `next-themes` | Will hardcode dark theme |
| `@radix-ui/react-toast` | Switching to Sonner-only |
| `recharts` | Only used by unused chart.tsx |
| `@hookform/resolvers` | Unused |
| `react-hook-form` | Unused |
| `zod` | Unused |
| `input-otp` | Unused |
| `embla-carousel-react` | Unused |
| `react-resizable-panels` | Unused |
| `vaul` | Unused |
| `cmdk` | Unused |
| `react-day-picker` | Unused |
| `@radix-ui/react-accordion` | Unused |
| `@radix-ui/react-alert-dialog` | Unused |
| `@radix-ui/react-aspect-ratio` | Unused |
| `@radix-ui/react-avatar` | Unused |
| `@radix-ui/react-collapsible` | Unused |
| `@radix-ui/react-context-menu` | Unused |
| `@radix-ui/react-dialog` | Unused |
| `@radix-ui/react-dropdown-menu` | Unused |
| `@radix-ui/react-hover-card` | Unused |
| `@radix-ui/react-menubar` | Unused |
| `@radix-ui/react-navigation-menu` | Unused |
| `@radix-ui/react-popover` | Unused |
| `@radix-ui/react-progress` | Unused |
| `@radix-ui/react-radio-group` | Unused |
| `@radix-ui/react-separator` | Unused |
| `@radix-ui/react-slider` | Unused |
| `@radix-ui/react-switch` | Unused |
| `@radix-ui/react-toggle` | Unused |
| `@radix-ui/react-toggle-group` | Unused |

### Dependencies to KEEP

| Package | Reason |
|---------|--------|
| `@radix-ui/react-checkbox` | Used in SettingsPanel |
| `@radix-ui/react-label` | Used throughout |
| `@radix-ui/react-scroll-area` | Used in LabelHistory |
| `@radix-ui/react-select` | Used in SettingsPanel |
| `@radix-ui/react-slot` | Core for Button |
| `@radix-ui/react-tabs` | Used in Index.tsx |
| `@radix-ui/react-tooltip` | Used in App.tsx |
| `@tanstack/react-query` | Core state |
| `react-router-dom` | Core routing |
| `date-fns` | Date formatting |
| `lucide-react` | Icons |
| `sonner` | Toast notifications (keeping this only) |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Styling |
| `tailwindcss-animate` | Animations |

---

## Part 2: UI Component Files to DELETE

```text
src/components/ui/
├── accordion.tsx         DELETE
├── alert-dialog.tsx      DELETE
├── alert.tsx             DELETE
├── aspect-ratio.tsx      DELETE
├── avatar.tsx            DELETE
├── breadcrumb.tsx        DELETE
├── calendar.tsx          DELETE
├── carousel.tsx          DELETE
├── chart.tsx             DELETE
├── collapsible.tsx       DELETE
├── command.tsx           DELETE
├── context-menu.tsx      DELETE
├── dialog.tsx            DELETE
├── drawer.tsx            DELETE
├── dropdown-menu.tsx     DELETE
├── form.tsx              DELETE
├── hover-card.tsx        DELETE
├── input-otp.tsx         DELETE
├── menubar.tsx           DELETE
├── navigation-menu.tsx   DELETE
├── pagination.tsx        DELETE
├── popover.tsx           DELETE
├── progress.tsx          DELETE
├── radio-group.tsx       DELETE
├── resizable.tsx         DELETE
├── separator.tsx         DELETE
├── sheet.tsx             DELETE
├── sidebar.tsx           DELETE
├── slider.tsx            DELETE
├── switch.tsx            DELETE
├── table.tsx             DELETE
├── toggle-group.tsx      DELETE
├── toggle.tsx            DELETE
├── toast.tsx             DELETE (Radix toast - removing)
├── toaster.tsx           DELETE (Radix toaster - removing)
├── use-toast.ts          DELETE (duplicate re-export)
```

**Files to KEEP**:
- badge.tsx, button.tsx, card.tsx, checkbox.tsx, input.tsx, label.tsx
- scroll-area.tsx, select.tsx, skeleton.tsx, sonner.tsx, tabs.tsx
- textarea.tsx, tooltip.tsx

---

## Part 3: Hardcode Dark Theme in Sonner

**File**: `src/components/ui/sonner.tsx`

Remove `next-themes` dependency and hardcode dark theme:

```typescript
// BEFORE:
import { useTheme } from "next-themes";
const { theme = "system" } = useTheme();

// AFTER:
// Hardcode dark theme - no next-themes dependency needed
theme="dark"
```

Updated file:

```typescript
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
```

---

## Part 4: Migrate to Sonner-Only Toasts

### API Differences

| Radix Toast (old) | Sonner (new) |
|-------------------|--------------|
| `toast({ title, description, variant: 'destructive' })` | `toast.error(description)` or `toast.error(title, { description })` |
| `toast({ title, description })` | `toast.success(description)` or `toast(title, { description })` |

### Files to Update

**`src/pages/Index.tsx`**

Change import:
```typescript
// BEFORE:
import { useToast } from '@/hooks/use-toast';
const { toast } = useToast();

// AFTER:
import { toast } from 'sonner';
// Remove useToast hook call
```

Update all toast calls (15 instances):

```typescript
// BEFORE (destructive):
toast({
  title: 'Configuration Required',
  description: 'Please complete the API and sender address configuration.',
  variant: 'destructive'
});

// AFTER:
toast.error('Configuration Required', {
  description: 'Please complete the API and sender address configuration.'
});

// BEFORE (success):
toast({
  title: 'Label Printed',
  description: `${product?.name} label sent to printer.`
});

// AFTER:
toast.success('Label Printed', {
  description: `${product?.name} label sent to printer.`
});
```

**`src/App.tsx`**

Remove Radix Toaster, keep only Sonner:

```typescript
// BEFORE:
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
...
<Toaster />
<Sonner />

// AFTER:
import { Toaster } from "@/components/ui/sonner";
...
<Toaster />
```

### Files to DELETE (Radix toast system)

| File | Reason |
|------|--------|
| `src/hooks/use-toast.ts` | Full Radix toast implementation - no longer needed |
| `src/components/ui/toast.tsx` | Radix toast components |
| `src/components/ui/toaster.tsx` | Radix toaster component |
| `src/components/ui/use-toast.ts` | Re-export file |

---

## Part 5: Code Refactoring

### 5.1 Remove lovable-tagger from vite.config.ts

```typescript
// BEFORE:
import { componentTagger } from "lovable-tagger";
plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),

// AFTER:
plugins: [react()],
```

### 5.2 Extract handlePrint logic (optional, for maintainability)

Create `src/hooks/useLabelPurchase.ts` to move the ~250 line `handlePrint` function from Index.tsx.

---

## Summary of All Changes

### Files to MODIFY

| File | Changes |
|------|---------|
| `package.json` | Remove 30+ unused dependencies |
| `vite.config.ts` | Remove lovable-tagger |
| `src/components/ui/sonner.tsx` | Remove next-themes, hardcode dark theme |
| `src/App.tsx` | Remove Radix Toaster, keep only Sonner |
| `src/pages/Index.tsx` | Migrate 15 toast calls from useToast to sonner |

### Files to DELETE

| Count | Files |
|-------|-------|
| 35 | Unused UI components in `src/components/ui/` |
| 4 | Radix toast files: `toast.tsx`, `toaster.tsx`, `use-toast.ts` (x2) |

### Files to CREATE

| File | Purpose |
|------|---------|
| `src/hooks/useLabelPurchase.ts` | Extract print logic from Index.tsx (optional) |

### Estimated Impact

- **Dependencies reduced**: From 43 to ~18 packages
- **Bundle size reduction**: ~200-300KB
- **UI component files reduced**: From 49 to ~14 files
- **Cleaner toast API**: Single system (Sonner) instead of two

---

## Final package.json Dependencies

```json
{
  "dependencies": {
    "@radix-ui/react-checkbox": "^1.3.2",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-scroll-area": "^1.2.9",
    "@radix-ui/react-select": "^2.2.5",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-tabs": "^1.1.12",
    "@radix-ui/react-tooltip": "^1.2.7",
    "@tanstack/react-query": "^5.83.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^3.6.0",
    "lucide-react": "^0.462.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.1",
    "sonner": "^1.7.4",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7"
  }
}
```
