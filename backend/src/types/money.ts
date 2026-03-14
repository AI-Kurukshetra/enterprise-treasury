export type DecimalString = string;

export interface Money {
  amount: DecimalString;
  currencyCode: string;
}
