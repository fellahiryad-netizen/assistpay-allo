"use client";

import { useState, useTransition, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { createUserAction } from "@/app/actions/user-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LEVEL_LABELS, MODULES, PROFILE_DEFAULTS, PROFILE_LABELS, isAdminProfile } from "@/features/access/services/access-rules";
import { ACCESS_LEVELS, PROFILE_KEYS, type AccessLevelKey, type AccessMap, type ProfileKey } from "@/features/access/types";
import { createUserSchema } from "@/features/users/schemas";
import { cn } from "@/utils/cn";

const LEVEL_STYLE: Readonly<Record<AccessLevelKey, string>> = {
  NONE: "text-muted-foreground",
  VIEW: "text-accent",
  EDIT: "text-success",
};

/** Création d'un compte : identité, profil, accès onglet par onglet et mot de passe initial. */
export function CreateUserDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileKey>("CHARGE_FACTURATION");
  const [access, setAccess] = useState<AccessMap>({ ...PROFILE_DEFAULTS.CHARGE_FACTURATION });
  const [pending, startTransition] = useTransition();
  const admin = isAdminProfile(profile);

  function chooseProfile(value: ProfileKey): void {
    setProfile(value);
    setAccess({ ...PROFILE_DEFAULTS[value] });
  }

  function setAll(level: AccessLevelKey): void {
    setAccess(Object.fromEntries(MODULES.map((module) => [module.key, level])) as AccessMap);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createUserSchema.safeParse({
      email: form.get("email"),
      firstName: form.get("firstName"),
      lastName: form.get("lastName"),
      profile,
      password: form.get("password"),
      access: admin ? {} : access,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Formulaire incomplet.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createUserAction(parsed.data);
      if (result.success) {
        setOpen(false);
        chooseProfile("CHARGE_FACTURATION");
      } else setError(result.error);
    });
  }

  const groups = [...new Set(MODULES.map((module) => module.group))];
  const changed = MODULES.filter((module) => access[module.key] !== PROFILE_DEFAULTS[profile][module.key]).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <UserPlus />
          Ajouter une personne
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nouveau compte</DialogTitle>
          <DialogDescription>Choisissez le profil, puis ajustez l&apos;accès à chaque onglet. Communiquez ensuite le mot de passe à la personne ; elle pourra le changer depuis « Mon compte ».</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
          <Field id="nu-first" label="Prénom">
            <Input id="nu-first" name="firstName" required autoComplete="off" />
          </Field>
          <Field id="nu-last" label="Nom">
            <Input id="nu-last" name="lastName" required autoComplete="off" />
          </Field>
          <Field id="nu-email" label="Adresse e-mail" className="sm:col-span-2">
            <Input id="nu-email" name="email" type="email" required autoComplete="off" />
          </Field>
          <Field id="nu-profile" label="Profil">
            <NativeSelect id="nu-profile" value={profile} onChange={(event) => chooseProfile(event.target.value as ProfileKey)}>
              {PROFILE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {PROFILE_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="nu-pw" label="Mot de passe initial (10 caractères minimum)">
            <Input id="nu-pw" name="password" type="password" minLength={10} required autoComplete="new-password" />
          </Field>
          <fieldset className="rounded-lg border p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold">Accès aux onglets</legend>
            {admin ? (
              <p className="text-sm text-muted-foreground">Le profil {PROFILE_LABELS[profile]} a tous les droits sur tous les onglets, y compris la gestion des comptes : rien à régler.</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Tout mettre en :</span>
                  {ACCESS_LEVELS.map((level) => (
                    <Button key={level} type="button" size="sm" variant="outline" onClick={() => setAll(level)}>
                      {LEVEL_LABELS[level]}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => chooseProfile(profile)}>
                    Revenir au profil
                  </Button>
                  {changed ? <span className="text-muted-foreground">{changed} onglet(s) différent(s) du profil</span> : null}
                </div>
                <div className="flex flex-col gap-3">
                  {groups.map((group) => (
                    <div key={group}>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                      <div className="flex flex-col divide-y rounded-md border">
                        {MODULES.filter((module) => module.group === group).map((module) => (
                          <label key={module.key} htmlFor={`nu-acc-${module.key}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                            <span>
                              {module.label}
                              {module.hint ? <span className="block text-xs text-muted-foreground">{module.hint}</span> : null}
                            </span>
                            <NativeSelect
                              id={`nu-acc-${module.key}`}
                              value={access[module.key]}
                              onChange={(event) => setAccess({ ...access, [module.key]: event.target.value as AccessLevelKey })}
                              className={cn("w-40 font-medium", LEVEL_STYLE[access[module.key]])}
                            >
                              {ACCESS_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                  {LEVEL_LABELS[level]}
                                </option>
                              ))}
                            </NativeSelect>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">La gestion des comptes (« Utilisateurs et accès ») reste réservée aux administrateurs. Tout reste modifiable ensuite dans le tableau des accès.</p>
              </>
            )}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              Créer le compte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
