export type ProofReviewExperience = "simple" | "advanced";

export function usesAdvancedQuantityAllocation(
  proofCount: number,
  reviewExperience: ProofReviewExperience
) {
  return proofCount > 1 && reviewExperience === "advanced";
}
