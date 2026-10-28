"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Message à la succursale, avec bouton pour le copier. */
export function CopyMessage({ message }: Readonly<{ message: string }>): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm">{message}</pre>
      <div>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copié" : "Copier le message"}
        </Button>
      </div>
    </div>
  );
}
