export type Intent =
  | "commit"
  | "orient"
  | "hear"
  | "fly"
  | "explain"
  | "challenge"
  | "check"
  | "return";

// A block is data. Code picks it; the model writes its words from `brief`.
export interface Block {
  id: string; // framework catalogue id, e.g. "LS-B1"
  intent: Intent;
  cost: "tap" | "short" | "deep"; // tap < 5 s, short < 30 s, deep is opt-in only
  answer_type: "choice" | "text" | "order";
  brief: string; // what the model must write: the question and, for "choice", the options
  question_text: string; // fallback words when the model can't write them
  opt_in?: true; // effortful blocks need the user's opt-in
  graded?: true; // a choice the model marks right or wrong when it writes it
  sure?: true; // shows "How sure?": only where the block's spec asks for it
  evidence?: true; // the answer points at a line skarp observed
}
