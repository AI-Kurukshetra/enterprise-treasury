export function decimalToMicros(value: string): bigint {
  const match = value.match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) {
    throw new Error(`Invalid numeric(20,6) decimal: ${value}`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = BigInt(match[2] ?? '0');
  const fractionalPart = BigInt((match[3] ?? '').padEnd(6, '0'));
  return sign * ((integerPart * 1_000_000n) + fractionalPart);
}

export function microsToDecimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const integerPart = absolute / 1_000_000n;
  const fractionalPart = (absolute % 1_000_000n).toString().padStart(6, '0');
  return `${sign}${integerPart.toString()}.${fractionalPart}`;
}

export function addDecimalStrings(values: string[]): string {
  return microsToDecimal(values.reduce((sum, value) => sum + decimalToMicros(value), 0n));
}

export function convertAtRate(amount: string, rate: string): string {
  const amountMicros = decimalToMicros(amount);
  const rateMicros = decimalToMicros(rate);
  const scaled = amountMicros * rateMicros;
  return microsToDecimal(scaled / 1_000_000n);
}
