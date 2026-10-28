"use client";

import { useState, useTransition } from "react";
import { analyseStatementAction, applyProposalsAction, previewStatementAction, recheckTodoAction } from "@/app/actions/statement-actions";
import type { ColumnMapping, Proposal, ProposalItem, StatementAnalysis, StatementPreview } from "@/features/statement/types";

/** Proposition affichée, avec son état coché et l'option choisie. */
export interface ProposalState {
  proposal: Proposal;
  checked: boolean;
  /** Index de l'option retenue : -1 = proposition principale, sinon index dans les alternatives. */
  choice: number;
}

/** État et actions de l'écran d'import du relevé. */
export interface UseStatementImport {
  step: "file" | "mapping" | "results";
  pending: boolean;
  error: string | null;
  message: string | null;
  preview: StatementPreview | null;
  mapping: ColumnMapping | null;
  analysis: StatementAnalysis | null;
  proposals: ProposalState[];
  chooseFile: (file: File) => void;
  setMapping: (key: keyof ColumnMapping, value: number) => void;
  analyse: () => void;
  recheck: () => void;
  toggle: (index: number, checked: boolean) => void;
  toggleAll: (sens: "CREDIT" | "DEBIT", checked: boolean) => void;
  choose: (index: number, choice: number) => void;
  apply: (sens: "CREDIT" | "DEBIT") => void;
  reset: () => void;
}

function itemsOf(state: ProposalState): ProposalItem[] {
  if (state.choice < 0) return state.proposal.items;
  const alternative = state.proposal.alternatives[state.choice];
  return alternative ? [alternative] : state.proposal.items;
}

/** Logique de l'import : fichier → colonnes → analyse → validation des rapprochements. */
export function useStatementImport(): UseStatementImport {
  const [step, setStep] = useState<UseStatementImport["step"]>("file");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [mapping, setMappingState] = useState<ColumnMapping | null>(null);
  const [analysis, setAnalysis] = useState<StatementAnalysis | null>(null);
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load(result: StatementAnalysis): void {
    setAnalysis(result);
    setProposals(result.proposals.map((proposal) => ({ proposal, checked: proposal.confidence !== "verifier", choice: -1 })));
    setStep("results");
  }

  function chooseFile(next: File): void {
    setError(null);
    setMessage(null);
    setFile(next);
    const form = new FormData();
    form.set("file", next);
    startTransition(async () => {
      const result = await previewStatementAction(form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
      setMappingState(result.data.mapping);
      setStep("mapping");
    });
  }

  function analyse(): void {
    if (!file || !mapping) return;
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("mapping", JSON.stringify(mapping));
    startTransition(async () => {
      const result = await analyseStatementAction(form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      load(result.data);
    });
  }

  function recheck(): void {
    setError(null);
    startTransition(async () => {
      const result = await recheckTodoAction();
      if (!result.success) {
        setError(result.error);
        return;
      }
      load(result.data);
    });
  }

  function apply(sens: "CREDIT" | "DEBIT"): void {
    const selected = proposals.filter((state) => state.checked && state.proposal.line.sens === sens);
    if (!selected.length) return;
    setError(null);
    startTransition(async () => {
      const result = await applyProposalsAction({
        proposals: selected.map((state) => ({
          line: state.proposal.line,
          items: itemsOf(state).map((item) => ({ invoiceId: item.invoiceId, part: item.part, amount: item.amount })),
        })),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      const done = new Set(selected.map((state) => state.proposal.line.key));
      setProposals((current) => current.filter((state) => !done.has(state.proposal.line.key)));
      setMessage(`${result.data.invoices} règlement(s) enregistré(s) pour ${result.data.lines} paiement(s) du relevé. Les totaux sont à jour.`);
    });
  }

  return {
    step,
    pending,
    error,
    message,
    preview,
    mapping,
    analysis,
    proposals,
    chooseFile,
    setMapping: (key, value) => setMappingState((current) => (current ? { ...current, [key]: value } : current)),
    analyse,
    recheck,
    toggle: (index, checked) => setProposals((current) => current.map((state, i) => (i === index ? { ...state, checked } : state))),
    toggleAll: (sens, checked) => setProposals((current) => current.map((state) => (state.proposal.line.sens === sens ? { ...state, checked } : state))),
    choose: (index, choice) => setProposals((current) => current.map((state, i) => (i === index ? { ...state, choice } : state))),
    apply,
    reset: () => {
      setStep("file");
      setFile(null);
      setPreview(null);
      setAnalysis(null);
      setProposals([]);
      setError(null);
      setMessage(null);
    },
  };
}
