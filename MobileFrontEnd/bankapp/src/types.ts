export type AccountType = "Checking" | "Savings" | "Credit";
export type TransactionType = "Deposit" | "Withdrawal" | "Transfer" | "Bill Pay" | "ATM" | "Interest";
export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED";
export type DepositStatus = "PENDING_REVIEW" | "APPROVED" | "DECLINED";
export type PaymentStatus = "SCHEDULED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type NotificationType = "deposit" | "payment" | "transfer" | "security";

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
}

export interface RegistrationInput {
  email: string;
  password: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  mobilePhone?: string;
  streetAddress?: string;
  apartmentUnit?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  taxId?: string;
}

export interface CustomerProfile {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  address: string;
  memberSince: string;
  mfaEnabled: boolean;
}

export interface BankAccount {
  id: string;
  nickname: string;
  type: AccountType;
  maskedNumber: string;
  status: "Open" | "Restricted";
  routingNumber: string;
  openedAt: string;
  closeEligible: boolean;
  balances: {
    availableBalance: number;
    currentBalance: number;
  };
}

export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  direction: "credit" | "debit";
  status: TransactionStatus;
  type: TransactionType;
  postedAt: string;
}

export interface Payee {
  id: string;
  name: string;
  category: string;
  accountMask: string;
}

export interface ScheduledPayment {
  id: string;
  payeeId: string;
  payeeName: string;
  accountId: string;
  amount: number;
  cadence: "Once" | "Monthly" | "Biweekly";
  deliverBy: string;
  status: PaymentStatus;
}

export interface Deposit {
  id: string;
  accountId: string;
  amount: number;
  submittedAt: string;
  status: DepositStatus;
  note?: string;
  images: {
    front?: { id: string; fileName: string; capturedAt: string };
    back?: { id: string; fileName: string; capturedAt: string };
  };
}

export interface AtmLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  distanceMiles: number;
  features: string[];
  hours: string;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
