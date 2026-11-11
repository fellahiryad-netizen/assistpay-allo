import { describe, expect, it } from "vitest";
import { ignoreLineSchema } from "@/features/statement/schemas";

describe("ignorer une ligne du relevé", () => {
  it("exige un motif connu", () => {
    expect(ignoreLineSchema.safeParse({ lineId: "l1", motif: "frais_bancaires" }).success).toBe(true);
    expect(ignoreLineSchema.safeParse({ lineId: "l1", motif: "" }).success).toBe(false);
    expect(ignoreLineSchema.safeParse({ lineId: "l1" }).success).toBe(false);
  });

  it("« autre » demande une précision", () => {
    expect(ignoreLineSchema.safeParse({ lineId: "l1", motif: "autre" }).success).toBe(false);
    expect(ignoreLineSchema.safeParse({ lineId: "l1", motif: "autre", note: "ok" }).success).toBe(false);
    expect(ignoreLineSchema.safeParse({ lineId: "l1", motif: "autre", note: "Remboursement client" }).success).toBe(true);
  });
});
