import crypto from 'crypto';

export function normalizeMerchantName(merchantName: string): string {
  return merchantName
    .toLowerCase()
    .replace(/\b(ltd|pvt|india|private|limited|co|inc|corp)\b/g, '') // strip suffixes
    .replace(/[\*\-\_\+]/g, ' ') // replace special chars with spaces
    .replace(/\s+/g, ' ') // collapse whitespaces
    .trim();
}

export function generateDedupHash(date: string, amount: number, merchantName: string): string {
  const normalizedMerchant = normalizeMerchantName(merchantName);
  const normalizedAmount = Number(amount).toFixed(2);
  const hashInput = `${date}_${normalizedAmount}_${normalizedMerchant}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}
