import { describe, expect, it } from "vitest";
import {
  algiersDateTime,
  algiersDay,
  cancelEnvoiIn,
  createEnvoiIn,
  ENVOI_EXPORT_HEADER,
  EMPTY_FILTERS,
  envoisToRows,
  filterEnvois,
  formatNumero,
  lastSentByBranch,
  overdueEnvois,
  paginate,
  parseEnvoiYear,
  parseNumero,
  sortEnvois,
  updateEnvoiIn,
} from "@/features/courrier/lib/envois";
import { envoiCancelSchema, envoiCreateSchema, envoiFiltersSchema, envoiUpdateSchema, numeroSchema } from "@/features/courrier/schemas";
import { MAX_ENVOIS_PAR_AN, type Envoi, type EnvoiLine, type EnvoiYear } from "@/features/courrier/types";

const line = (extra: Partial<EnvoiLine> = {}): EnvoiLine => ({ brancheId: "caar-oran-400", compagnie: "CAAR", designation: "SUCCURSALE CAAR ORAN 400", qnt: 1, destination: "ORAN", observation: "COURRIER : DOCUMENT FACTURATION", ...extra });
const draft = (extra: Record<string, unknown> = {}) => ({ annee: 2026, creeLe: "2026-11-24T09:30:00.000Z", creePar: "Riad", creeParId: "u1", date: "2026-11-24", ramasseur: "Hichem", remarque: "", lignes: [line()], ...extra });
const empty: EnvoiYear = { seq: 0, items: [] };
const make = (n: number, extra: Partial<Envoi> = {}): Envoi => {
  const created = createEnvoiIn({ seq: n - 1, items: [] }, draft());
  if (!created.ok) throw new Error("création");
  return { ...created.value, ...extra };
};

describe("numérotation BE-AAAA-NNN", () => {
  it("format sur trois chiffres au moins, relecture", () => {
    expect(formatNumero(2026, 1)).toBe("BE-2026-001");
    expect(formatNumero(2026, 42)).toBe("BE-2026-042");
    expect(formatNumero(2026, 1234)).toBe("BE-2026-1234");
    expect(parseNumero("BE-2026-007")).toEqual({ year: 2026, sequence: 7 });
    expect(parseNumero("FA-2026-007")).toBeNull();
    expect(parseNumero("BE-26-7")).toBeNull();
  });

  it("séquentielle, sans trou ni doublon", () => {
    let doc = empty;
    const numbers: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const result = createEnvoiIn(doc, draft());
      expect(result.ok).toBe(true);
      if (result.ok) {
        doc = result.doc;
        numbers.push(result.value.numero);
      }
    }
    expect(numbers[0]).toBe("BE-2026-001");
    expect(numbers.at(-1)).toBe("BE-2026-012");
    expect(new Set(numbers).size).toBe(12);
    expect(doc.seq).toBe(12);
  });

  it("repart de 001 chaque année (séquence propre à l'année)", () => {
    const first = createEnvoiIn(empty, draft({ annee: 2027 }));
    expect(first.ok && first.value.numero).toBe("BE-2027-001");
  });

  it("un numéro annulé n'est jamais réattribué", () => {
    const one = createEnvoiIn(empty, draft());
    if (!one.ok) throw new Error("x");
    const cancelled = cancelEnvoiIn(one.doc, "BE-2026-001", "Erreur", "Riad", "2026-11-24T10:00:00.000Z");
    if (!cancelled.ok) throw new Error("x");
    const next = createEnvoiIn(cancelled.doc, draft());
    expect(next.ok && next.value.numero).toBe("BE-2026-002");
  });

  it("la séquence ne repart pas en arrière même si le compteur stocké est en retard", () => {
    const doc = parseEnvoiYear({ seq: 1, items: [make(5)] });
    expect(doc.seq).toBe(5);
    const next = createEnvoiIn(doc, draft());
    expect(next.ok && next.value.numero).toBe("BE-2026-006");
  });
});

describe("création, ramassage, annulation", () => {
  it("création : statut établi, pas de date de ramassage, total de plis, créateur et instant conservés", () => {
    const result = createEnvoiIn(empty, draft({ lignes: [line({ qnt: 2 }), line({ brancheId: "", compagnie: "", designation: "Autre", qnt: 3 })] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ numero: "BE-2026-001", statut: "ETABLI", ramasseLe: "", total: 5, creePar: "Riad", creeParId: "u1", creeLe: "2026-11-24T09:30:00.000Z", ramasseur: "Hichem" });
    }
  });

  it("plafond : refus explicite au 501e bordereau, rien n'est écrasé", () => {
    const items = Array.from({ length: MAX_ENVOIS_PAR_AN }, (_, i) => make(i + 1));
    const full: EnvoiYear = { seq: MAX_ENVOIS_PAR_AN, items };
    const refused = createEnvoiIn(full, draft());
    expect(refused).toMatchObject({ ok: false, code: "VALIDATION" });
    if (!refused.ok) expect(refused.error).toContain("500");
    const almost = createEnvoiIn({ seq: MAX_ENVOIS_PAR_AN - 1, items: items.slice(0, -1) }, draft());
    expect(almost.ok && almost.value.numero).toBe("BE-2026-500");
  });

  it("date de ramassage : passe en ramassé, peut être effacée, jamais future ni antérieure au bordereau", () => {
    const base = make(1);
    const doc: EnvoiYear = { seq: 1, items: [base] };
    const set = updateEnvoiIn(doc, base.numero, { ramasseLe: "2026-11-25", ramasseur: "Hichem", remarque: "RAS" }, "2026-11-25");
    expect(set.ok && set.value.after).toMatchObject({ statut: "RAMASSE", ramasseLe: "2026-11-25", remarque: "RAS" });
    expect(set.ok && set.value.before.statut).toBe("ETABLI");
    if (!set.ok) throw new Error("x");
    const cleared = updateEnvoiIn(set.doc, base.numero, { ramasseLe: "", ramasseur: "Hichem", remarque: "RAS" }, "2026-11-25");
    expect(cleared.ok && cleared.value.after.statut).toBe("ETABLI");
    expect(updateEnvoiIn(doc, base.numero, { ramasseLe: "2026-11-30", ramasseur: "", remarque: "" }, "2026-11-25")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(updateEnvoiIn(doc, base.numero, { ramasseLe: "2026-11-20", ramasseur: "", remarque: "" }, "2026-11-25")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(updateEnvoiIn(doc, "BE-2026-099", { ramasseLe: "", ramasseur: "", remarque: "" }, "2026-11-25")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("la création, le créateur et les lignes ne changent pas à la modification", () => {
    const base = make(1);
    const result = updateEnvoiIn({ seq: 1, items: [base] }, base.numero, { ramasseLe: "2026-11-24", ramasseur: "Karim", remarque: "x" }, "2026-11-24");
    expect(result.ok && result.value.after).toMatchObject({ creeLe: base.creeLe, creePar: base.creePar, lignes: base.lignes, total: base.total, date: base.date, ramasseur: "Karim" });
  });

  it("annulation : motif et auteur conservés, bordereau gardé ; plus de modification ni de seconde annulation", () => {
    const base = make(1);
    const doc: EnvoiYear = { seq: 1, items: [base] };
    const cancelled = cancelEnvoiIn(doc, base.numero, "Envoi reporté", "Riad", "2026-11-24T11:00:00.000Z");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) throw new Error("x");
    expect(cancelled.doc.items).toHaveLength(1);
    expect(cancelled.value.after).toMatchObject({ statut: "ANNULE", motifAnnulation: "Envoi reporté", annulePar: "Riad", annuleLe: "2026-11-24T11:00:00.000Z" });
    expect(updateEnvoiIn(cancelled.doc, base.numero, { ramasseLe: "", ramasseur: "", remarque: "" }, "2026-11-25")).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(cancelEnvoiIn(cancelled.doc, base.numero, "Encore", "Riad", "2026-11-24T12:00:00.000Z")).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(cancelEnvoiIn(doc, "BE-2026-099", "x", "Riad", "")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("lecture tolérante", () => {
  it("clé absente, valeur nulle ou illisible : année vide", () => {
    for (const value of [undefined, null, 3, "x", [], true]) expect(parseEnvoiYear(value)).toEqual({ seq: 0, items: [] });
    expect(parseEnvoiYear({})).toEqual({ seq: 0, items: [] });
  });

  it("ignore les bordereaux sans numéro valable, doublons ou sans ligne ; recalcule le total ; champs manquants en vide", () => {
    const year = parseEnvoiYear({
      seq: "x",
      items: [
        null,
        { numero: "XX-1", lignes: [line()] },
        { numero: "BE-2026-001", lignes: [] },
        { numero: "BE-2026-002", date: "2026-11-24", lignes: [{ designation: "A", qnt: 2 }, { designation: "B", qnt: "x" }, { designation: "" }], total: 99, statut: "ANNULE", motifAnnulation: "m" },
        { numero: "BE-2026-002", lignes: [line()] },
        { numero: "BE-2026-003", ramasseLe: "2026-11-25", lignes: [line()], statut: "NIMPORTE" },
      ],
    });
    expect(year.items.map((item) => item.numero)).toEqual(["BE-2026-002", "BE-2026-003"]);
    expect(year.items[0]).toMatchObject({ total: 3, statut: "ANNULE", ramasseLe: "", ramasseur: "", remarque: "", creeLe: "" });
    expect(year.items[1]).toMatchObject({ statut: "RAMASSE", ramasseLe: "2026-11-25" });
    expect(year.seq).toBe(3);
  });

  it("ancien enregistrement sans compagnie ni identifiant de fiche", () => {
    const year = parseEnvoiYear({ items: [{ numero: "BE-2026-001", lignes: [{ designation: "SUCCURSALE CAAR ORAN 400", qnt: 1 }] }] });
    expect(year.items[0]?.lignes[0]).toEqual({ brancheId: "", compagnie: "", designation: "SUCCURSALE CAAR ORAN 400", qnt: 1, destination: "", observation: "" });
  });
});

describe("historique : filtres, tri, pagination", () => {
  const a = make(1, { creeLe: "2026-11-02T09:00:00.000Z", ramasseLe: "2026-11-03", statut: "RAMASSE", ramasseur: "Hichem", lignes: [line()] });
  const b = make(2, { creeLe: "2026-11-10T09:00:00.000Z", lignes: [line({ brancheId: "caat-setif", compagnie: "CAAT", designation: "SUCCURSALE CAAT SETIF", destination: "SÉTIF" })] });
  const c = make(3, { creeLe: "2026-11-20T23:30:00.000Z", statut: "ANNULE", motifAnnulation: "erreur", ramasseur: "Karim", lignes: [line({ brancheId: "caat-alger-3", compagnie: "CAAT", designation: "SUCCURSALE CAAT ALGER 3", destination: "CITE CHAABANI HYDRA ALGER" })] });
  const all = [a, b, c];
  const ids = (list: Envoi[]) => list.map((item) => item.numero);

  it("recherche sans accent ni casse : numéro, succursale, destination, ramasseur", () => {
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, q: "setif" }))).toEqual(["BE-2026-002"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, q: "hydra" }))).toEqual(["BE-2026-003"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, q: "be-2026-001" }))).toEqual(["BE-2026-001"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, q: "karim" }))).toEqual(["BE-2026-003"]);
    expect(filterEnvois(all, { ...EMPTY_FILTERS, q: "introuvable" })).toEqual([]);
  });

  it("période de création au jour d'Alger (23h30 UTC = lendemain à Alger)", () => {
    expect(algiersDay("2026-11-20T23:30:00.000Z")).toBe("2026-11-21");
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, du: "2026-11-21" }))).toEqual(["BE-2026-003"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, au: "2026-11-20" }))).toEqual(["BE-2026-001", "BE-2026-002"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, du: "2026-11-05", au: "2026-11-15" }))).toEqual(["BE-2026-002"]);
  });

  it("ramassé ou non, statut, compagnie", () => {
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, ramasse: "oui" }))).toEqual(["BE-2026-001"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, ramasse: "non" }))).toEqual(["BE-2026-002", "BE-2026-003"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, statut: "ANNULE" }))).toEqual(["BE-2026-003"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, compagnie: "CAAR" }))).toEqual(["BE-2026-001"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, compagnie: "CAAT" }))).toEqual(["BE-2026-002", "BE-2026-003"]);
    expect(ids(filterEnvois(all, { ...EMPTY_FILTERS, compagnie: "CAAT", ramasse: "non", statut: "ETABLI" }))).toEqual(["BE-2026-002"]);
  });

  it("tri : numéro, création, ramassage (sans date après ou avant) ; la liste d'origine n'est pas modifiée", () => {
    expect(ids(sortEnvois(all, "numero-desc"))).toEqual(["BE-2026-003", "BE-2026-002", "BE-2026-001"]);
    expect(ids(sortEnvois(all, "numero-asc"))).toEqual(["BE-2026-001", "BE-2026-002", "BE-2026-003"]);
    expect(ids(sortEnvois(all, "creation-desc"))).toEqual(["BE-2026-003", "BE-2026-002", "BE-2026-001"]);
    expect(ids(sortEnvois(all, "creation-asc"))).toEqual(["BE-2026-001", "BE-2026-002", "BE-2026-003"]);
    expect(ids(sortEnvois(all, "ramassage-desc"))[0]).toBe("BE-2026-001");
    expect(ids(sortEnvois(all, "ramassage-asc"))[2]).toBe("BE-2026-001");
    expect(ids(all)).toEqual(["BE-2026-001", "BE-2026-002", "BE-2026-003"]);
  });

  it("pagination bornée", () => {
    const list = Array.from({ length: 53 }, (_, i) => i);
    expect(paginate(list, 1, 25)).toMatchObject({ page: 1, pageCount: 3 });
    expect(paginate(list, 3, 25).items).toHaveLength(3);
    expect(paginate(list, 99, 25).page).toBe(3);
    expect(paginate(list, -4, 25).page).toBe(1);
    expect(paginate([], 1, 25)).toEqual({ items: [], page: 1, pageCount: 1 });
  });

  it("dernier envoi par fiche : bordereau non annulé le plus récent", () => {
    const later = make(4, { date: "2026-11-24", lignes: [line()] });
    const result = lastSentByBranch([a, b, c, later]);
    expect(result["caar-oran-400"]).toBe("2026-11-24");
    expect(result["caat-setif"]).toBe("2026-11-24");
    expect(result["caat-alger-3"]).toBeUndefined();
    expect(lastSentByBranch([])).toEqual({});
  });

  it("alerte : établis sans date de ramassage depuis plus de 2 jours seulement", () => {
    const recent = make(5, { creeLe: "2026-11-22T09:00:00.000Z" });
    const old = make(6, { creeLe: "2026-11-20T09:00:00.000Z" });
    const picked = make(7, { creeLe: "2026-11-01T09:00:00.000Z", ramasseLe: "2026-11-02", statut: "RAMASSE" });
    const cancelled = make(8, { creeLe: "2026-11-01T09:00:00.000Z", statut: "ANNULE" });
    expect(overdueEnvois([recent, old, picked, cancelled], "2026-11-24").map((item) => item.numero)).toEqual(["BE-2026-006"]);
    expect(overdueEnvois([make(9, { creeLe: "2026-11-22T09:00:00.000Z" })], "2026-11-24")).toEqual([]);
    expect(overdueEnvois([make(9, { creeLe: "2026-11-21T09:00:00.000Z" })], "2026-11-24")).toHaveLength(1);
  });
});

describe("export Excel", () => {
  it("une ligne par succursale envoyée, dates en JJ/MM/AAAA, heure d'Alger", () => {
    const envoi = make(1, { creeLe: "2026-11-24T09:30:00.000Z", date: "2026-11-24", ramasseLe: "2026-11-25", statut: "RAMASSE", lignes: [line({ qnt: 2 }), line({ brancheId: "caat-setif", compagnie: "CAAT", designation: "SUCCURSALE CAAT SETIF", destination: "SÉTIF" })] });
    const rows = envoisToRows([envoi]);
    expect(rows).toHaveLength(2);
    expect(ENVOI_EXPORT_HEADER).toHaveLength(rows[0]!.length);
    expect(rows[0]).toEqual(["BE-2026-001", "24/11/2026 10:30", "24/11/2026", "25/11/2026", "Hichem", "CAAR", "SUCCURSALE CAAR ORAN 400", "ORAN", 2, "COURRIER : DOCUMENT FACTURATION", "Ramassé", "Riad"]);
    expect(rows[1]?.[6]).toBe("SUCCURSALE CAAT SETIF");
    expect(envoisToRows([])).toEqual([]);
  });

  it("sans date de ramassage : cellule vide ; heure d'Alger formatée", () => {
    expect(envoisToRows([make(1)])[0]?.[3]).toBe("");
    expect(algiersDateTime("2026-06-30T22:30:00.000Z")).toBe("30/06/2026 23:30");
    expect(algiersDateTime("pas une date")).toBe("");
  });
});

describe("validation des saisies", () => {
  const line1 = { brancheId: "a", compagnie: "CAAR", designation: "SUCCURSALE CAAR ORAN 400", qnt: 1, destination: "ORAN", observation: "x" };
  const valid = { date: "2026-11-24", ramasseur: "Hichem", remarque: "", lignes: [line1] };

  it("bordereau : accepte, nettoie, refuse date impossible, lignes absentes ou trop nombreuses, quantité fausse", () => {
    expect(envoiCreateSchema.safeParse(valid).success).toBe(true);
    expect(envoiCreateSchema.parse({ ...valid, ramasseur: `  Karim${String.fromCharCode(160)}  B ` }).ramasseur).toBe("Karim B");
    expect(envoiCreateSchema.safeParse({ ...valid, date: "2026-02-31" }).success).toBe(false);
    expect(envoiCreateSchema.safeParse({ ...valid, lignes: [] }).success).toBe(false);
    expect(envoiCreateSchema.safeParse({ ...valid, lignes: Array.from({ length: 61 }, () => line1) }).success).toBe(false);
    for (const qnt of [0, -1, 1.5, Number.NaN, 10000]) expect(envoiCreateSchema.safeParse({ ...valid, lignes: [{ ...line1, qnt }] }).success, String(qnt)).toBe(false);
    expect(envoiCreateSchema.safeParse({ ...valid, lignes: [{ ...line1, designation: "  " }] }).success).toBe(false);
    expect(envoiCreateSchema.safeParse({ ...valid, ramasseur: "x".repeat(81) }).success).toBe(false);
    expect(envoiCreateSchema.safeParse({ ...valid, lignes: [{ ...line1, compagnie: "GAM" }] }).success).toBe(false);
  });

  it("modification et annulation : numéro valide, date réelle ou vide, motif d'au moins 3 caractères", () => {
    const update = { numero: "BE-2026-001", ramasseLe: "2026-11-25", ramasseur: "", remarque: "" };
    expect(envoiUpdateSchema.safeParse(update).success).toBe(true);
    expect(envoiUpdateSchema.safeParse({ ...update, ramasseLe: "" }).success).toBe(true);
    expect(envoiUpdateSchema.safeParse({ ...update, ramasseLe: "25/11/2026" }).success).toBe(false);
    expect(envoiUpdateSchema.safeParse({ ...update, numero: "FA-1" }).success).toBe(false);
    expect(envoiCancelSchema.safeParse({ numero: "BE-2026-001", motif: "ok" }).success).toBe(false);
    expect(envoiCancelSchema.safeParse({ numero: "BE-2026-001", motif: "   " }).success).toBe(false);
    expect(envoiCancelSchema.safeParse({ numero: "BE-2026-001", motif: "Envoi reporté" }).success).toBe(true);
    expect(numeroSchema.safeParse("BE-2026-1234").success).toBe(true);
  });

  it("filtres d'adresse : valeurs illisibles ignorées", () => {
    expect(envoiFiltersSchema.parse({ q: " setif ", du: "2026-11-01", au: "n'importe quoi", ramasse: "peut-être", statut: "ANNULE", compagnie: "GAM" })).toEqual({ q: "setif", du: "2026-11-01", au: "", ramasse: "", statut: "ANNULE", compagnie: "" });
    expect(envoiFiltersSchema.parse({})).toEqual({ q: "", du: "", au: "", ramasse: "", statut: "", compagnie: "" });
  });
});
