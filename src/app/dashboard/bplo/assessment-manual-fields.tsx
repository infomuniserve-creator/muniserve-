export type ManualFieldSpec = {
  key: string; // matches the form field name finalizeAssessment reads (manual_lbt / manual_mayors_permit / manual_regulatory_<feeRuleId>)
  label: string;
  initial: number | null; // the engine's own computed value, if it found one -- a starting point BPLO can accept or overwrite, not a guess presented as final
  note?: string;
};
