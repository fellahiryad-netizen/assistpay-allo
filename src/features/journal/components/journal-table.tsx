import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { JournalItem } from "@/features/journal/types";
import { formatDateTime } from "@/utils/format";

/** Propriétés du tableau du journal. */
export interface JournalTableProps {
  items: JournalItem[];
}

/** Journal des actions : date, auteur, action et objet. */
export function JournalTable({ items }: Readonly<JournalTableProps>): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Par</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Objet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(item.at)}</TableCell>
              <TableCell className="whitespace-nowrap">{item.userName || "—"}</TableCell>
              <TableCell className="whitespace-nowrap font-medium">{item.action}</TableCell>
              <TableCell className="min-w-64">{item.objet}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
