import { Mail, Phone, Truck } from "lucide-react";
import { telHref } from "@/features/courrier/lib/clean";
import { EMS_ROLE_LABELS, type EmsContact } from "@/features/courrier/types";

/** Numéro cliquable (appel direct sur mobile) ; simple texte si le numéro n'est pas exploitable. */
export function PhoneLink({ phone, className }: Readonly<{ phone: string; className?: string }>): React.JSX.Element {
  const href = telHref(phone);
  if (!phone) return <span className="text-muted-foreground">—</span>;
  return href ? (
    <a href={href} className={className ?? "inline-flex items-center gap-1 font-medium text-primary hover:underline"}>
      <Phone className="size-3.5" aria-hidden />
      {phone}
    </a>
  ) : (
    <span>{phone}</span>
  );
}

/** Adresse e-mail cliquable. */
export function MailLink({ email }: Readonly<{ email: string }>): React.JSX.Element {
  if (!email) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={`mailto:${email}`} className="inline-flex items-center gap-1 break-all font-medium text-primary hover:underline">
      <Mail className="size-3.5" aria-hidden />
      {email}
    </a>
  );
}

/** Propriétés de l'encart EMS. */
export interface EmsCardProps {
  societe: string;
  contacts: EmsContact[];
}

/** Encart « Courrier EMS » : qui appeler pour faire ramasser le courrier, et qui joindre en cas de réclamation ou d'absence du ramasseur. */
export function EmsCard({ societe, contacts }: Readonly<EmsCardProps>): React.JSX.Element {
  const ordered = [...contacts].sort((a, b) => Number(a.role === "RECLAMATION") - Number(b.role === "RECLAMATION"));
  return (
    <section aria-labelledby="ems-title" className="mb-6 rounded-lg border-2 border-primary bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Truck className="size-5 text-primary" aria-hidden />
        <h2 id="ems-title" className="text-lg font-semibold">
          Courrier {societe}
        </h2>
        <span className="text-sm text-muted-foreground">: ramassage des originaux de factures</span>
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun contact enregistré pour le prestataire de courrier. Ajoutez-en un dans la section « Prestataire de courrier » plus bas.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ordered.map((contact) => (
            <div key={contact.id} className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{EMS_ROLE_LABELS[contact.role]}</p>
              <p className="text-base font-semibold">{contact.nom}</p>
              <p className="mt-1 text-lg">
                <PhoneLink phone={contact.telephone} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" />
              </p>
              {contact.email ? (
                <p className="mt-1 text-sm">
                  <MailLink email={contact.email} />
                </p>
              ) : null}
              {contact.remarque ? <p className="mt-1 text-sm text-muted-foreground">{contact.remarque}</p> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
