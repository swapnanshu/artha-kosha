import { ParsedTransaction } from '../types';

const BANK_SMS_PATTERNS: Record<string, RegExp[]> = {
  ICICI: [
    // "ICICI Bank Acct XX4521 debited for Rs 1,250.00 on 15-Jun-25; Swiggy"
    /ICICI\s*Bank\s*Acct\s*XX(\d{4})\s*(debited|credited)\s*for\s*Rs\.?\s*([\d,]+\.?\d*)\s*on\s*([\d-]+\w*);?\s*(.+)/i,
    // "Your ICICI Credit Card XX9012 has been used for Rs.2500.00 at AMAZON on 15-Jun"
    /ICICI\s*Credit\s*Card\s*XX(\d{4})\s*.*?Rs\.?\s*([\d,]+\.?\d*)\s*at\s*(.+?)\s*on\s*([\d-]+\w*)/i,
  ],
  SBI: [
    // "SBI: Your A/c X1234 Debited Rs.500.00 on 15Jun25 by UPI ref 412345"
    /SBI.*?A\/c\s*X(\d{4})\s*(Debited|Credited)\s*Rs\.?\s*([\d,]+\.?\d*)\s*on\s*(\S+)/i,
    // "SBI Card: Rs.1200.00 spent on SBI Credit Card ending 5678 at SWIGGY on 15Jun"
    /SBI\s*Card.*?Rs\.?\s*([\d,]+\.?\d*)\s*spent.*?ending\s*(\d{4})\s*at\s*(.+?)\s*on\s*(\S+)/i,
  ],
  Kotak: [
    // "Kotak Bank: A/c XX1234 debited INR 800.00 on 15-06-25 at PVR CINEMAS"
    /Kotak.*?A\/c\s*XX(\d{4})\s*(debited|credited)\s*INR\s*([\d,]+\.?\d*)\s*on\s*([\d-]+)\s*(?:at|to)\s*(.+)/i,
    // "Kotak Credit Card XX5678: Rs 2,500 spent at Amazon on 15Jun"
    /Kotak\s*Credit\s*Card\s*XX(\d{4}).*?Rs\.?\s*([\d,]+\.?\d*)\s*spent\s*at\s*(.+?)\s*on\s*(\S+)/i,
  ],
  RBL: [
    // "RBL Bank: INR 1500.00 spent on RBL Credit Card ending 3456 at FLIPKART on 15-Jun-25"
    /RBL.*?INR\s*([\d,]+\.?\d*)\s*spent.*?ending\s*(\d{4})\s*at\s*(.+?)\s*on\s*([\d-]+\w*)/i,
    // "RBL: Your A/c XX1234 is debited for Rs.2000 on 15-Jun by NEFT"
    /RBL.*?A\/c\s*XX(\d{4})\s*.*?(debited|credited)\s*.*?Rs\.?\s*([\d,]+\.?\d*)\s*on\s*([\d-]+\w*)/i,
  ],
  IndusInd: [
    // "IndusInd Bank: Rs.3500.00 debited from A/c XX7890 on 15Jun25 for UPI/SWIGGY"
    /IndusInd.*?Rs\.?\s*([\d,]+\.?\d*)\s*(debited|credited)\s*.*?A\/c\s*XX(\d{4})\s*on\s*(\S+)\s*(?:for|to)\s*(.+)/i,
    // "IndusInd CC XX1234: Rs 1,200.00 spent at ZOMATO on 15-Jun"
    /IndusInd\s*CC\s*XX(\d{4}).*?Rs\.?\s*([\d,]+\.?\d*)\s*spent\s*at\s*(.+?)\s*on\s*(\S+)/i,
  ],
  Axis: [
    // "Axis Bank: INR 2,500 debited from A/c XX4567 on 15-Jun-25 to AMAZON"
    /Axis.*?INR\s*([\d,]+\.?\d*)\s*(debited|credited)\s*.*?A\/c\s*XX(\d{4})\s*on\s*([\d-]+\w*)\s*to\s*(.+)/i,
    // "Axis Credit Card XX8901: Transaction of Rs 1500.00 at BIG BASKET on 15Jun"
    /Axis\s*Credit\s*Card\s*XX(\d{4}).*?Rs\.?\s*([\d,]+\.?\d*)\s*at\s*(.+?)\s*on\s*(\S+)/i,
  ],
  UPI: [
    // "Paid Rs 340 to Zomato via UPI from ICICI Bank XX4521"
    /Paid\s*Rs\.?\s*([\d,]+\.?\d*)\s*to\s*(.+?)\s*via\s*UPI/i,
    // "Rs.500 sent to merchant@upi from A/c XX1234"
    /Rs\.?\s*([\d,]+\.?\d*)\s*sent\s*to\s*(.+?)\s*from/i,
    // "UPI txn of Rs 200 to DMART successful"
    /UPI\s*txn\s*of\s*Rs\.?\s*([\d,]+\.?\d*)\s*to\s*(.+?)\s*(successful|completed)/i,
  ],
};

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ''));
}

export function parseTransactionFromText(text: string): ParsedTransaction | null {
  // Check each bank's regex patterns
  for (const [bank, patterns] of Object.entries(BANK_SMS_PATTERNS)) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Different matches have different structures depending on bank
        if (bank === 'ICICI') {
          if (match.length === 6) {
            // debited/credited regex
            const [, lastFour, action, amount, , merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: action.toLowerCase() === 'credited' ? 'income' : 'expense',
              accountLastFour: lastFour,
              bank: 'ICICI',
              paymentMethod: 'net_banking',
            };
          } else if (match.length === 5) {
            // Credit card regex
            const [, lastFour, amount, merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: 'expense',
              accountLastFour: lastFour,
              bank: 'ICICI',
              paymentMethod: 'credit_card',
            };
          }
        }

        if (bank === 'SBI') {
          if (text.includes('SBI Card') || text.includes('SBI Credit Card')) {
            const [, amount, lastFour, merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: 'expense',
              accountLastFour: lastFour,
              bank: 'SBI',
              paymentMethod: 'credit_card',
            };
          } else {
            const [, lastFour, action, amount] = match;
            // Attempt to extract merchant after UPI ref
            const upiMatch = text.match(/to\s+(.+?)\s+(?:ref|txn|via)/i);
            const merchant = upiMatch ? upiMatch[1] : 'Unknown Merchant';
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: action.toLowerCase() === 'credited' ? 'income' : 'expense',
              accountLastFour: lastFour,
              bank: 'SBI',
              paymentMethod: 'UPI',
            };
          }
        }

        if (bank === 'Kotak') {
          if (text.includes('Credit Card')) {
            const [, lastFour, amount, merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: 'expense',
              accountLastFour: lastFour,
              bank: 'Kotak',
              paymentMethod: 'credit_card',
            };
          } else {
            const [, lastFour, action, amount, , merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: action.toLowerCase() === 'credited' ? 'income' : 'expense',
              accountLastFour: lastFour,
              bank: 'Kotak',
              paymentMethod: 'net_banking',
            };
          }
        }

        if (bank === 'RBL') {
          if (text.includes('Credit Card')) {
            const [, amount, lastFour, merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: 'expense',
              accountLastFour: lastFour,
              bank: 'RBL',
              paymentMethod: 'credit_card',
            };
          } else {
            const [, lastFour, action, amount] = match;
            return {
              amount: parseAmount(amount),
              merchantName: 'RBL Account Transaction',
              type: action.toLowerCase() === 'credited' ? 'income' : 'expense',
              accountLastFour: lastFour,
              bank: 'RBL',
              paymentMethod: 'net_banking',
            };
          }
        }

        if (bank === 'IndusInd') {
          if (text.includes('CC') || text.includes('Credit Card')) {
            const [, lastFour, amount, merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: 'expense',
              accountLastFour: lastFour,
              bank: 'IndusInd',
              paymentMethod: 'credit_card',
            };
          } else {
            const [, amount, action, lastFour, , merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: action.toLowerCase() === 'credited' ? 'income' : 'expense',
              accountLastFour: lastFour,
              bank: 'IndusInd',
              paymentMethod: 'UPI',
            };
          }
        }

        if (bank === 'Axis') {
          if (text.includes('Credit Card')) {
            const [, lastFour, amount, merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: 'expense',
              accountLastFour: lastFour,
              bank: 'Axis',
              paymentMethod: 'credit_card',
            };
          } else {
            const [, amount, action, lastFour, , merchant] = match;
            return {
              amount: parseAmount(amount),
              merchantName: merchant.trim(),
              type: action.toLowerCase() === 'credited' ? 'income' : 'expense',
              accountLastFour: lastFour,
              bank: 'Axis',
              paymentMethod: 'net_banking',
            };
          }
        }

        if (bank === 'UPI') {
          const [, amount, merchant] = match;
          return {
            amount: parseAmount(amount),
            merchantName: merchant.trim(),
            type: 'expense',
            paymentMethod: 'UPI',
            bank: 'Unknown',
          };
        }
      }
    }
  }

  return null;
}
