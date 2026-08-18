export type ExactNumericErrorCode =
  | "DECIMAL_GRAMMAR"
  | "DECIMAL_LENGTH"
  | "DENOMINATOR_ZERO"
  | "DIVISION_ZERO"
  | "IMPLICIT_COERCION"
  | "INVALID_INPUT"
  | "INVALID_RATIONAL"
  | "MAGNITUDE_LIMIT"
  | "SNAPSHOT_CONTENT"
  | "SNAPSHOT_SCHEMA"
  | "SNAPSHOT_NORMALIZATION"
  | "STEP_MISMATCH"
  | "STEP_NOT_POSITIVE"
  | "VALUE_NEGATIVE";

export class ExactNumericError extends Error {
  public constructor(
    public readonly code: ExactNumericErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExactNumericError";
  }
}
