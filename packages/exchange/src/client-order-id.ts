import type { ClientOrderId } from "./types.js";

const MAXIMUM_CLIENT_ORDER_ID_LENGTH = 36;

export class ClientOrderIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientOrderIdError";
  }
}

/**
 * Creates a canonical Bybit V5 client order identifier or fails closed.
 */
export function makeClientOrderId(value: unknown): ClientOrderId {
  if (typeof value !== "string") throw new ClientOrderIdError("Client order ID must be a string");
  if (value.length === 0 || value.length > MAXIMUM_CLIENT_ORDER_ID_LENGTH) {
    throw new ClientOrderIdError("Client order ID must contain 1 to 36 characters");
  }
  if (!isCanonicalClientOrderId(value)) {
    throw new ClientOrderIdError(
      "Client order ID must use only ASCII letters, digits, hyphen, or underscore",
    );
  }
  return value as ClientOrderId;
}

function isCanonicalClientOrderId(value: string): boolean {
  for (const character of value) {
    const isUppercaseLetter = character >= "A" && character <= "Z";
    const isLowercaseLetter = character >= "a" && character <= "z";
    const isDigit = character >= "0" && character <= "9";
    if (!isUppercaseLetter && !isLowercaseLetter && !isDigit && character !== "-" && character !== "_") {
      return false;
    }
  }
  return true;
}
