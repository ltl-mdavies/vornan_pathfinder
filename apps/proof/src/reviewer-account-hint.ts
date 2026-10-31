/** Navigation convenience only. Never use these values for authorization. */
export interface ReviewerSignInOptions { emailHint?: string; chooseAccount?: boolean }

export function reviewerGoogleParameters(options: ReviewerSignInOptions = {}): Record<string, string> {
  if (options.chooseAccount) return { prompt: "select_account" };
  const email = options.emailHint?.trim() ?? "";
  if (!email) return {};
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address or leave it blank.");
  }
  return { login_hint: email };
}
