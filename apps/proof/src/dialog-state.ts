export type ProofDialogFocusTarget = {
  isConnected?: boolean;
  focus: (options?: FocusOptions) => void;
};

export function restoreProofDialogFocus(target: ProofDialogFocusTarget | null) {
  if (!target || target.isConnected === false) return false;
  try {
    target.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}
