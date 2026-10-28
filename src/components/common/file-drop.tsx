"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/utils/cn";

/** Propriétés de la zone de dépôt. */
export interface FileDropProps {
  label: string;
  hint?: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}

/** Zone de dépôt de fichier (glisser-déposer ou clic). */
export function FileDrop({ label, hint, accept = ".xlsx,.xls,.xlsm,.csv", disabled = false, onFile }: Readonly<FileDropProps>): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed bg-card px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          over ? "border-primary bg-primary/5" : "hover:border-primary/60",
        )}
      >
        <FileSpreadsheet className="size-8 text-primary" aria-hidden />
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}
