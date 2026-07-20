export type ProofState = "waiting" | "pending" | "revised" | "approved" | "reference" | "cancelled" | "missing" | "error";

export interface ProofVersion {
  version_id: string;
  created_at: string | null;
  filename: string | null;
  content_type: string | null;
  preview_kind: "image" | "pdf" | "download" | "unavailable";
  preview_url: string | null;
  download_url: string | null;
  approval_status: string | null;
  approved_at: string | null;
  comments: {
    text: string | null;
    created_at: string | null;
    attachments: { filename: string; url: string | null; content_type: string | null }[];
  }[];
  technical_checks: { name: string; status: string | null }[];
  current: boolean;
}

export interface ProofTask {
  task_id: string;
  line_number: string | null;
  product_name: string | null;
  quantity: number | null;
  state: ProofState;
  sibling_index: number;
  sibling_count: number;
  feedback_required: boolean;
  feedback_acknowledged: boolean;
  current_version: ProofVersion | null;
  versions: ProofVersion[];
}

export interface ProofOrder {
  order_number: string;
  order_title: string | null;
  order_status: string | null;
  health: "active" | "complete" | "missing" | "stale" | "error";
  tasks: ProofTask[];
  counts: {
    pending: number;
    regenerating: number;
    waiting: number;
    reviewed: number;
    total: number;
  };
  last_synced_at: string;
  access: { scope: "view"; decisions_enabled: false };
}

export interface ProofParticipant {
  participant_id: string;
  display_name: string;
  email: string;
}

export interface ProofActivity {
  identified_reviewers: number;
  last_activity_at: string | null;
  reviewer_names_visible: false;
}
