"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setModuleAccessAction, setUserActiveAction, setUserProfileAction } from "@/app/actions/user-actions";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isAdminProfile, LEVEL_LABELS, MODULES, PROFILE_DEFAULTS, PROFILE_LABELS } from "@/features/access/services/access-rules";
import { ACCESS_LEVELS, PROFILE_KEYS, type AccessLevelKey, type ModuleKey, type ProfileKey } from "@/features/access/types";
import { ResetPasswordDialog } from "@/features/users/components/reset-password-dialog";
import type { UserAccessRow } from "@/features/users/types";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";

/** Propriétés du tableau des accès. */
export interface AccessMatrixProps {
  users: UserAccessRow[];
  currentUserId: string;
}

type Patch =
  | { kind: "level"; userId: string; module: ModuleKey; level: AccessLevelKey | null }
  | { kind: "profile"; userId: string; profile: ProfileKey }
  | { kind: "active"; userId: string; active: boolean };

const LEVEL_STYLE: Readonly<Record<AccessLevelKey, string>> = {
  NONE: "text-muted-foreground",
  VIEW: "text-accent",
  EDIT: "text-success",
};

function applyPatch(rows: UserAccessRow[], patch: Patch): UserAccessRow[] {
  return rows.map((row) => {
    if (row.id !== patch.userId) return row;
    if (patch.kind === "active") return { ...row, active: patch.active };
    if (patch.kind === "profile") {
      const access = isAdminProfile(patch.profile) ? PROFILE_DEFAULTS.ADMINISTRATEUR : { ...PROFILE_DEFAULTS[patch.profile], ...row.overrides };
      return { ...row, profile: patch.profile, access };
    }
    const overrides = { ...row.overrides };
    if (patch.level === null) delete overrides[patch.module];
    else overrides[patch.module] = patch.level;
    const level = patch.level ?? PROFILE_DEFAULTS[row.profile][patch.module];
    return { ...row, overrides, access: { ...row.access, [patch.module]: level } };
  });
}

function isLevel(value: string): value is AccessLevelKey {
  return (ACCESS_LEVELS as readonly string[]).includes(value);
}

function isProfile(value: string): value is ProfileKey {
  return (PROFILE_KEYS as readonly string[]).includes(value);
}

/**
 * Tableau des accès : une ligne par personne, une colonne par onglet.
 * Chaque case propose « niveau du profil », Aucun accès, Consultation ou Modification ;
 * le changement s'affiche tout de suite et il est contrôlé puis enregistré côté serveur.
 */
export function AccessMatrix({ users, currentUserId }: Readonly<AccessMatrixProps>): React.JSX.Element {
  const [rows, addPatch] = useOptimistic<UserAccessRow[], Patch>(users, applyPatch);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function send(patch: Patch): void {
    setError(null);
    startTransition(async () => {
      addPatch(patch);
      const result =
        patch.kind === "level"
          ? await setModuleAccessAction({ userId: patch.userId, module: patch.module, level: patch.level })
          : patch.kind === "profile"
            ? await setUserProfileAction({ userId: patch.userId, profile: patch.profile })
            : await setUserActiveAction({ userId: patch.userId, active: patch.active });
      if (!result.success) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-56 bg-muted">Personne</TableHead>
              <TableHead className="min-w-48">Profil</TableHead>
              {MODULES.map((module) => (
                <TableHead key={module.key} className="min-w-44 normal-case" title={module.hint}>
                  <span className="block text-xs font-normal text-muted-foreground">{module.group}</span>
                  {module.label}
                </TableHead>
              ))}
              <TableHead className="min-w-40">Compte</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const fixed = isAdminProfile(row.profile);
              const self = row.id === currentUserId;
              return (
                <TableRow key={row.id} className={cn(!row.active && "opacity-60")}>
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <p className="font-medium">
                      {row.firstName} {row.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.lastLoginAt ? `Dernière connexion : ${formatDateTime(row.lastLoginAt)}` : "Jamais connecté"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Profil de ${row.email}`}
                      value={row.profile}
                      disabled={self}
                      onChange={(event) => isProfile(event.target.value) && send({ kind: "profile", userId: row.id, profile: event.target.value })}
                    >
                      {PROFILE_KEYS.map((profile) => (
                        <option key={profile} value={profile}>
                          {PROFILE_LABELS[profile]}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  {MODULES.map((module) => {
                    const effective = row.access[module.key];
                    const override = row.overrides[module.key];
                    if (fixed) {
                      return (
                        <TableCell key={module.key}>
                          <span className={cn("text-sm", LEVEL_STYLE.EDIT)}>Modification</span>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={module.key}>
                        <NativeSelect
                          aria-label={`${module.label} – ${row.email}`}
                          value={override ?? ""}
                          className={cn("h-9 text-xs", LEVEL_STYLE[effective], override && "border-primary")}
                          onChange={(event) =>
                            send({ kind: "level", userId: row.id, module: module.key, level: isLevel(event.target.value) ? event.target.value : null })
                          }
                        >
                          <option value="">{LEVEL_LABELS[PROFILE_DEFAULTS[row.profile][module.key]]} (profil)</option>
                          {ACCESS_LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {LEVEL_LABELS[level]}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <div className="flex flex-col items-start gap-1.5">
                      {row.active ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Désactivé</Badge>}
                      {!row.hasPassword ? <Badge variant="warning">Mot de passe à définir</Badge> : null}
                      <ResetPasswordDialog userId={row.id} email={row.email} />
                      {!self ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-primary hover:underline"
                          onClick={() => send({ kind: "active", userId: row.id, active: !row.active })}
                        >
                          {row.active ? "Désactiver le compte" : "Réactiver le compte"}
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Les profils Administrateur et Direction ont tous les droits. Pour les autres, « … (profil) » applique le niveau prévu par le profil ; un niveau choisi
        à la main (case encadrée) prend le dessus. Les lignes de paie et les onglets RH ne sont visibles qu&apos;avec l&apos;accès RH.
      </p>
    </div>
  );
}
