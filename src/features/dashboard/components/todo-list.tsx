import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TodoItem } from "@/features/dashboard/services/todo-service";

/** Propriétés du bloc « À faire ». */
export interface TodoListProps {
  items: TodoItem[];
}

/** Bloc « À faire » de l'accueil : chaque ligne mène directement à l'écran qui la traite. */
export function TodoList({ items }: Readonly<TodoListProps>): React.JSX.Element {
  if (items.length === 0) {
    return (
      <Card className="mb-5 flex items-center gap-2 p-4 text-sm">
        <CheckCircle2 aria-hidden className="size-4 text-green-700" />
        Rien à traiter pour le moment.
      </Card>
    );
  }
  return (
    <Card className="mb-5 p-4">
      <h2 className="mb-2 font-semibold">À faire</h2>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href} className="flex items-center justify-between gap-3 py-2 hover:bg-muted/50">
              <span>
                <span className="font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.detail}</span>
              </span>
              <Badge variant={item.tone === "urgent" ? "warning" : "muted"}>{item.count}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
