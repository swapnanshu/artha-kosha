/**
 * Shape returned by every Server Action behind a form. Plain data only: it
 * crosses the network boundary, so no classes, dates or functions.
 */
export interface FormState {
  status: "idle" | "ok" | "error";
  message: string;
  /** The row that was written, so the client can link to it. */
  id?: string;
}

export const idleForm: FormState = { status: "idle", message: "" };
