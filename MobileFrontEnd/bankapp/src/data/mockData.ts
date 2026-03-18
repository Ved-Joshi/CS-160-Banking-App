import type {
  AtmLocation,
  BankAccount,
  CustomerProfile,
  Deposit,
  NotificationItem,
  Payee,
  ScheduledPayment,
  Transaction,
  User,
} from "../types";

export const mockUser: User = {
  id: "user-1",
  email: "alex.morgan@examplebank.com",
  username: "alex.morgan",
  firstName: "Alex",
  lastName: "Morgan",
};

export const mockProfile: CustomerProfile = {
  id: "profile-1",
  fullName: "Alex Morgan",
  username: "alex.morgan",
  email: "alex.morgan@examplebank.com",
  phone: "(415) 555-0193",
  address: "1700 Mission Street, San Francisco, CA 94103",
  memberSince: "2022-08-14T08:00:00.000Z",
  mfaEnabled: true,
};

export const mockAccounts: BankAccount[] = [
  {
    id: "acct-checking",
    nickname: "Advantage Checking",
    type: "Checking",
    maskedNumber: "...1034",
    status: "Open",
    routingNumber: "121000358",
    openedAt: "2022-08-14T08:00:00.000Z",
    closeEligible: false,
    balances: { availableBalance: 8420.14, currentBalance: 8642.14 },
  },
  {
    id: "acct-savings",
    nickname: "High Yield Savings",
    type: "Savings",
    maskedNumber: "...2291",
    status: "Open",
    routingNumber: "121000358",
    openedAt: "2022-09-10T08:00:00.000Z",
    closeEligible: false,
    balances: { availableBalance: 18240.22, currentBalance: 18240.22 },
  },
  {
    id: "acct-credit",
    nickname: "Travel Rewards Card",
    type: "Credit",
    maskedNumber: "...4498",
    status: "Restricted",
    routingNumber: "N/A",
    openedAt: "2023-02-03T08:00:00.000Z",
    closeEligible: false,
    balances: { availableBalance: 4210, currentBalance: 790 },
  },
];

export const mockTransactions: Transaction[] = [
  { id: "txn-1", accountId: "acct-checking", description: "Payroll Deposit", amount: 3450, direction: "credit", status: "COMPLETED", type: "Deposit", postedAt: "2026-03-01T15:14:00.000Z" },
  { id: "txn-2", accountId: "acct-checking", description: "Pacific Gas & Electric", amount: 142.87, direction: "debit", status: "COMPLETED", type: "Bill Pay", postedAt: "2026-02-28T09:00:00.000Z" },
  { id: "txn-3", accountId: "acct-checking", description: "Transfer to Savings", amount: 600, direction: "debit", status: "COMPLETED", type: "Transfer", postedAt: "2026-02-27T16:40:00.000Z" },
  { id: "txn-4", accountId: "acct-savings", description: "Transfer from Checking", amount: 600, direction: "credit", status: "COMPLETED", type: "Transfer", postedAt: "2026-02-27T16:40:00.000Z" },
  { id: "txn-5", accountId: "acct-checking", description: "Partner ATM Withdrawal", amount: 120, direction: "debit", status: "COMPLETED", type: "ATM", postedAt: "2026-02-25T20:12:00.000Z" },
  { id: "txn-6", accountId: "acct-checking", description: "Mobile Check Deposit", amount: 425.43, direction: "credit", status: "PENDING", type: "Deposit", postedAt: "2026-03-03T18:10:00.000Z" },
  { id: "txn-7", accountId: "acct-credit", description: "Card Payment Received", amount: 250, direction: "credit", status: "COMPLETED", type: "Transfer", postedAt: "2026-02-26T12:02:00.000Z" },
];

export const mockPayees: Payee[] = [
  { id: "payee-1", name: "Pacific Gas & Electric", category: "Utilities", accountMask: "...9814" },
  { id: "payee-2", name: "San Francisco Water", category: "Utilities", accountMask: "...4471" },
  { id: "payee-3", name: "Vertex Property Group", category: "Rent", accountMask: "...9910" },
];

export const mockPayments: ScheduledPayment[] = [
  { id: "payment-1", payeeId: "payee-1", payeeName: "Pacific Gas & Electric", accountId: "acct-checking", amount: 142.87, cadence: "Monthly", deliverBy: "2026-03-12T09:00:00.000Z", status: "SCHEDULED" },
  { id: "payment-2", payeeId: "payee-3", payeeName: "Vertex Property Group", accountId: "acct-checking", amount: 2450, cadence: "Monthly", deliverBy: "2026-03-05T09:00:00.000Z", status: "PROCESSING" },
  { id: "payment-3", payeeId: "payee-2", payeeName: "San Francisco Water", accountId: "acct-checking", amount: 72.11, cadence: "Once", deliverBy: "2026-02-20T09:00:00.000Z", status: "FAILED" },
];

export const mockDeposits: Deposit[] = [
  {
    id: "dep-1",
    accountId: "acct-checking",
    amount: 425.43,
    submittedAt: "2026-03-03T18:10:00.000Z",
    status: "PENDING_REVIEW",
    note: "Review in progress. Funds may be available in 1 business day.",
    images: {
      front: { id: "img-front-1", fileName: "rent-front.jpg", capturedAt: "2026-03-03T18:08:00.000Z" },
      back: { id: "img-back-1", fileName: "rent-back.jpg", capturedAt: "2026-03-03T18:08:30.000Z" },
    },
  },
  {
    id: "dep-2",
    accountId: "acct-checking",
    amount: 1200,
    submittedAt: "2026-02-14T16:20:00.000Z",
    status: "APPROVED",
    note: "Deposit approved and posted.",
    images: {},
  },
];

export const mockAtms: AtmLocation[] = [
  {
    id: "atm-1",
    name: "Chase ATM - Market Street",
    address: "1 Market St",
    city: "San Francisco",
    state: "CA",
    zip: "94105",
    distanceMiles: 0.4,
    features: ["Drive-up", "Walk-up", "24 hours"],
    hours: "Open 24 hours",
  },
  {
    id: "atm-2",
    name: "Chase ATM - Hayes Valley",
    address: "401 Grove St",
    city: "San Francisco",
    state: "CA",
    zip: "94102",
    distanceMiles: 1.2,
    features: ["Walk-up", "Wheelchair accessible"],
    hours: "Mon-Sun 6am-10pm",
  },
  {
    id: "atm-3",
    name: "Chase ATM - Oakland Downtown",
    address: "801 Broadway",
    city: "Oakland",
    state: "CA",
    zip: "94607",
    distanceMiles: 8.8,
    features: ["Drive-up", "Deposit-enabled"],
    hours: "Mon-Sun 7am-11pm",
  },
];

export const mockNotifications: NotificationItem[] = [
  {
    id: "notif-1",
    type: "deposit",
    title: "Deposit under review",
    body: "Your mobile check deposit for $425.43 is pending review.",
    createdAt: "2026-03-03T18:12:00.000Z",
    read: false,
  },
  {
    id: "notif-2",
    type: "payment",
    title: "Payment failed",
    body: "San Francisco Water could not be delivered on Feb 20. Review your payment details.",
    createdAt: "2026-02-20T10:00:00.000Z",
    read: false,
  },
  {
    id: "notif-3",
    type: "transfer",
    title: "Transfer completed",
    body: "Your transfer to High Yield Savings posted successfully.",
    createdAt: "2026-02-27T16:41:00.000Z",
    read: true,
  },
];
