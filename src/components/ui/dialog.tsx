"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Fenêtre modale centrée (Radix Dialog). */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  Readonly<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-5 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Fermer</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/** En-tête de fenêtre. */
export function DialogHeader({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1 pr-6", className)} {...props} />;
}

/** Pied de fenêtre (boutons). */
export function DialogFooter({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>): React.JSX.Element {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

/** Titre de fenêtre. */
export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  Readonly<ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>
>(function DialogTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />;
});

/** Texte d'explication de la fenêtre. */
export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  Readonly<ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />;
});
