import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { supabase } from "./supabaseClient";
import type {
  BankAccount,
  Transaction,
  Payee,
  ScheduledPayment,
  Deposit,
  DepositStatus,
  AtmLocation,
  AtmSearchResponse,
  AtmWithdrawalResult,
  CustomerProfile,
  UpdateCustomerProfileInput,
  ExternalAccount,
  ExternalLinkSession,
  ExternalTransferSubmissionResult,
  ExternalTransfer,
  ExternalTransferPlan,
} from "../types";

export type DepositUploadTarget = { path: string; token: string; signedUrl: string };
export type DepositUploadUrls = { bucket: string; front: DepositUploadTarget; back: DepositUploadTarget };
export type CreateDepositUploadUrlsInput = {
  frontFileName: string;
  backFileName: string;
  frontContentType: string;
  backContentType: string;
  frontFileSizeBytes: number;
  backFileSizeBytes: number;
};
export type CreateDepositInput = {
  accountId: string;
  amount: number;
  depositMethod: "atm" | "check";
  depositType?: "cash" | "check";
  note?: string;
  frontImagePath?: string;
  backImagePath?: string;
};

function resolveApiUrl(): string {
  const config = Constants.expoConfig?.extra ?? {};
  let apiUrl = config.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? process.env.VITE_API_URL;

  if (typeof apiUrl !== "string" || !apiUrl) {
    const debuggerHost = typeof Constants.manifest === "object" && Constants.manifest?.debuggerHost;
    const host = typeof debuggerHost === "string" ? debuggerHost.split(":")[0] : "localhost";
    apiUrl = `http://${host}:8000`;
  }

  if (Platform.OS === "android" && apiUrl.includes("localhost")) {
    apiUrl = apiUrl.replace("localhost", "10.0.2.2");
  }

  return apiUrl;
}

const API_URL = resolveApiUrl();

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text) as any;
    const detail = data?.detail ?? data?.message ?? data;
    if (typeof detail === "string") return detail;
    if (typeof detail?.message === "string") return detail.message;
    return JSON.stringify(detail);
  } catch {
    return text;
  }
}

// Helper to get authorization header with session token
async function getAuthHeader(): Promise<{ Authorization: string }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("No valid session. Please log in.");
  }
  return {
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

// ============= ACCOUNTS =============
export async function fetchAccounts(): Promise<BankAccount[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/accounts`, { headers });
  if (!response.ok) throw new Error("Failed to fetch accounts");

  const data = await response.json();
  return (Array.isArray(data) ? data : []).map((account: any) => ({
    ...account,
    canClose: Boolean(account?.canClose ?? account?.closeEligible ?? false),
    closeEligible: Boolean(account?.closeEligible ?? account?.canClose ?? false),
    closeReasons: Array.isArray(account?.closeReasons) ? account.closeReasons.filter((r: any) => typeof r === "string") : [],
    isDefaultInternalReceive: Boolean(account?.isDefaultInternalReceive ?? false),
  })) as BankAccount[];
}

export async function createAccount(
  accountType: "checking" | "savings" | "credit",
  nickname?: string
): Promise<BankAccount> {
  const headers = await getAuthHeader();
  const accountNickname = nickname?.trim() || `${accountType.charAt(0).toUpperCase() + accountType.slice(1)} account`;
  const response = await fetch(`${API_URL}/api/accounts`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: accountType.charAt(0).toUpperCase() + accountType.slice(1),
      nickname: accountNickname,
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    try {
      const data = JSON.parse(errorPayload);
      const detail = data.detail ?? data.message ?? JSON.stringify(data);
      throw new Error(detail);
    } catch {
      throw new Error(errorPayload || "Failed to create account");
    }
  }

  return (await response.json()) as BankAccount;
}

export async function closeAccount(accountId: string): Promise<void> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/accounts/${accountId}/close`, {
    method: "POST",
    headers,
  });
  if (response.ok) return;

  const errorPayload = await response.text();
  try {
    const data = JSON.parse(errorPayload);
    const detail = data.detail ?? data.message ?? data;
    const message = typeof detail?.message === "string" ? detail.message : undefined;
    const reasons = Array.isArray(detail?.reasons) ? detail.reasons.filter((r: any) => typeof r === "string") : [];
    if (message && reasons.length) {
      throw new Error(`${message}\n${reasons.map((r: string) => `• ${r}`).join("\n")}`);
    }
    if (message) throw new Error(message);
    throw new Error(typeof detail === "string" ? detail : errorPayload || "Failed to close account");
  } catch {
    throw new Error(errorPayload || "Failed to close account");
  }
}

// ============= PROFILE =============
export async function fetchProfile(): Promise<CustomerProfile> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/me/profile`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch profile"));
  return (await response.json()) as CustomerProfile;
}

export async function updateProfile(input: UpdateCustomerProfileInput): Promise<CustomerProfile> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/me/profile`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to update profile"));
  return (await response.json()) as CustomerProfile;
}

// ============= TRANSACTIONS =============
export async function fetchTransactions(accountId?: string): Promise<Transaction[]> {
  const headers = await getAuthHeader();
  const params = accountId ? `?account_id=${accountId}` : "";
  const response = await fetch(`${API_URL}/api/transactions${params}`, { headers });
  if (!response.ok) throw new Error("Failed to fetch transactions");
  
  const data = await response.json();
  return data.map((tx: any) => ({
    id: tx.id,
    accountId: tx.accountId,
    description: tx.description,
    amount: tx.amount,
    direction: tx.direction,
    status: tx.status,
    type: tx.type,
    postedAt: tx.postedAt,
  }));
}

// ============= TRANSFERS =============
export async function createTransfer(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  memo?: string,
  transferDate?: string
): Promise<any> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/transfers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAccountId,
      toAccountId,
      amount,
      memo,
      transferDate: transferDate || new Date().toISOString().split("T")[0],
    }),
  });
  if (!response.ok) {
    const errorPayload = await response.text();
    try {
      const data = JSON.parse(errorPayload);
      const detail = data.detail ?? data.message ?? JSON.stringify(data);
      throw new Error(detail);
    } catch {
      throw new Error(errorPayload || "Failed to create transfer");
    }
  }
  return await response.json();
}

// ============= WITHDRAWALS =============
export async function submitAtmWithdrawal(accountId: string, amount: number): Promise<AtmWithdrawalResult> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/withdrawals/atm`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, amount }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to submit ATM withdrawal"));
  return (await response.json()) as AtmWithdrawalResult;
}

// ============= MEMBER TRANSFERS =============
export async function resolveMemberRecipient(
  recipientEmail: string
): Promise<any> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/member-transfers/resolve-recipient`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ recipientEmail }),
  });
  if (!response.ok) {
    const errorPayload = await response.text();
    try {
      const data = JSON.parse(errorPayload);
      const detail = data.detail ?? data.message ?? JSON.stringify(data);
      throw new Error(detail);
    } catch {
      throw new Error(errorPayload || "Failed to resolve recipient");
    }
  }
  return await response.json();
}

export async function createMemberTransfer(
  fromAccountId: string,
  recipientEmail: string,
  amount: number,
  memo?: string,
  scheduleMode?: string,
  transferDate?: string,
  cadence?: string,
  startDate?: string,
  runTime?: string,
  endDate?: string,
  timezone?: string
): Promise<any> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/member-transfers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAccountId,
      recipientEmail,
      amount,
      memo,
      scheduleMode: scheduleMode || "NOW",
      transferDate,
      cadence,
      startDate,
      runTime,
      endDate,
      timezone,
    }),
  });
  if (!response.ok) {
    const errorPayload = await response.text();
    try {
      const data = JSON.parse(errorPayload);
      const detail = data.detail ?? data.message ?? JSON.stringify(data);
      throw new Error(detail);
    } catch {
      throw new Error(errorPayload || "Failed to create member transfer");
    }
  }
  return await response.json();
}

export async function fetchMemberTransferPlans(): Promise<any[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/member-transfers/plans`, { headers });
  if (!response.ok) throw new Error("Failed to fetch member transfer plans");
  return await response.json();
}

export async function cancelMemberTransferPlan(planId: string): Promise<any> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/member-transfers/plans/${planId}/cancel`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error("Failed to cancel member transfer plan");
  return await response.json();
}

export async function updateMemberTransferPlan(planId: string, payload: Record<string, unknown>): Promise<any> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/member-transfers/plans/${planId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to update member transfer plan"));
  return await response.json();
}

export async function retryMemberTransferPlan(planId: string): Promise<any> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/member-transfers/plans/${planId}/retry`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to retry member transfer plan"));
  return await response.json();
}

// ============= EXTERNAL ACCOUNTS =============
export async function fetchExternalAccounts(): Promise<ExternalAccount[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-accounts`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch external accounts"));
  return (await response.json()) as ExternalAccount[];
}

export async function createExternalAccount(input: {
  bankName: string;
  nickname: string;
  accountType: "Checking" | "Savings";
  routingNumber: string;
  accountNumber: string;
  confirmAccountNumber: string;
}): Promise<ExternalAccount> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-accounts`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to link external account"));
  return (await response.json()) as ExternalAccount;
}

export async function createExternalLinkSession(): Promise<ExternalLinkSession> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-accounts/link-session`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to start external link session"));
  return (await response.json()) as ExternalLinkSession;
}

export async function completeExternalLink(accountId: string): Promise<ExternalAccount> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-accounts/link-complete`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to complete external linking"));
  return (await response.json()) as ExternalAccount;
}

// ============= EXTERNAL TRANSFERS =============
export async function submitExternalTransfer(input: {
  fromAccountId: string;
  externalAccountId: string;
  amount: number;
  memo?: string;
  scheduleMode?: "NOW" | "SCHEDULED";
  transferDate?: string;
  cadence?: string;
  startDate?: string;
  runTime?: string;
  endDate?: string;
  timezone?: string;
}): Promise<ExternalTransferSubmissionResult> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-transfers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to submit external transfer"));
  return (await response.json()) as ExternalTransferSubmissionResult;
}

export async function fetchExternalTransfers(): Promise<ExternalTransfer[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-transfers`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch external transfers"));
  return (await response.json()) as ExternalTransfer[];
}

export async function fetchExternalTransferPlans(): Promise<ExternalTransferPlan[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-transfers/plans`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch external transfer plans"));
  return (await response.json()) as ExternalTransferPlan[];
}

export async function cancelExternalTransferPlan(planId: string): Promise<ExternalTransferPlan> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-transfers/plans/${planId}/cancel`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to cancel external transfer plan"));
  return (await response.json()) as ExternalTransferPlan;
}

export async function updateExternalTransferPlan(planId: string, payload: Record<string, unknown>): Promise<ExternalTransferPlan> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-transfers/plans/${planId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to update external transfer plan"));
  return (await response.json()) as ExternalTransferPlan;
}

export async function retryExternalTransferPlan(planId: string): Promise<ExternalTransferPlan> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/external-transfers/plans/${planId}/retry`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to retry external transfer plan"));
  return (await response.json()) as ExternalTransferPlan;
}

// ============= BILL PAYMENTS =============
export async function fetchPayees(): Promise<Payee[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payees`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch payees"));
  
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map((payee: any) => ({
    id: String(payee?.id ?? ""),
    name: String(payee?.name ?? "Unknown payee"),
    category: String(payee?.category ?? "Other"),
    accountMask: String(payee?.accountMask ?? payee?.account_mask ?? "...----"),
  })) as Payee[];
}

export async function createPayee(input: {
  name: string;
  category: string;
  routingNumber: string;
  accountNumber: string;
  confirmAccountNumber: string;
}): Promise<Payee> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payees`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to create payee"));
  const payee = await response.json();
  return {
    id: String(payee?.id ?? ""),
    name: String(payee?.name ?? "Unknown payee"),
    category: String(payee?.category ?? "Other"),
    accountMask: String(payee?.accountMask ?? payee?.account_mask ?? "...----"),
  };
}

export async function fetchBillPayments(): Promise<ScheduledPayment[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch bill payments"));
  
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map((payment: any) => ({
    id: String(payment?.id ?? ""),
    payeeId: String(payment?.payeeId ?? ""),
    payeeName: String(payment?.payeeName ?? "Unknown"),
    accountId: String(payment?.accountId ?? ""),
    amount: Number(payment?.amount ?? 0),
    cadence: (String(payment?.cadence ?? "Once") as ScheduledPayment["cadence"]),
    deliverBy: String(payment?.deliverBy ?? ""),
    status: (String(payment?.status ?? "SCHEDULED") as ScheduledPayment["status"]),
    failureReason: typeof payment?.failureReason === "string" ? payment.failureReason : null,
  })) as ScheduledPayment[];
}

export async function createBillPayment(
  input: {
    payeeId: string;
    accountId: string;
    amount: number;
    cadence: ScheduledPayment["cadence"];
    deliverBy: string;
  }
): Promise<ScheduledPayment> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to create bill payment"));
  
  const payment = (await response.json()) as any;
  return {
    id: String(payment?.id ?? ""),
    payeeId: String(payment?.payeeId ?? ""),
    payeeName: String(payment?.payeeName ?? "Unknown"),
    accountId: String(payment?.accountId ?? ""),
    amount: Number(payment?.amount ?? 0),
    cadence: (String(payment?.cadence ?? "Once") as ScheduledPayment["cadence"]),
    deliverBy: String(payment?.deliverBy ?? ""),
    status: (String(payment?.status ?? "SCHEDULED") as ScheduledPayment["status"]),
    failureReason: typeof payment?.failureReason === "string" ? payment.failureReason : null,
  };
}

export async function cancelBillPayment(paymentId: string): Promise<void> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments/${paymentId}/cancel`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to cancel bill payment"));
}

export async function retryBillPayment(paymentId: string): Promise<ScheduledPayment> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments/${paymentId}/retry`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": createIdempotencyKey() },
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to retry bill payment"));
  const payment = (await response.json()) as any;
  return {
    id: String(payment?.id ?? ""),
    payeeId: String(payment?.payeeId ?? ""),
    payeeName: String(payment?.payeeName ?? "Unknown"),
    accountId: String(payment?.accountId ?? ""),
    amount: Number(payment?.amount ?? 0),
    cadence: (String(payment?.cadence ?? "Once") as ScheduledPayment["cadence"]),
    deliverBy: String(payment?.deliverBy ?? ""),
    status: (String(payment?.status ?? "SCHEDULED") as ScheduledPayment["status"]),
    failureReason: typeof payment?.failureReason === "string" ? payment.failureReason : null,
  };
}

export async function updateBillPayment(
  paymentId: string,
  payload: {
    payeeId?: string;
    amount?: number;
    cadence?: ScheduledPayment["cadence"];
    deliverBy?: string;
  }
): Promise<ScheduledPayment> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments/${encodeURIComponent(paymentId)}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to update bill payment"));
  const payment = (await response.json()) as any;
  return {
    id: String(payment?.id ?? ""),
    payeeId: String(payment?.payeeId ?? ""),
    payeeName: String(payment?.payeeName ?? "Unknown"),
    accountId: String(payment?.accountId ?? ""),
    amount: Number(payment?.amount ?? 0),
    cadence: (String(payment?.cadence ?? "Once") as ScheduledPayment["cadence"]),
    deliverBy: String(payment?.deliverBy ?? ""),
    status: (String(payment?.status ?? "SCHEDULED") as ScheduledPayment["status"]),
    failureReason: typeof payment?.failureReason === "string" ? payment.failureReason : null,
  };
}

// ============= DEPOSITS =============
export async function getDepositUploadUrls(input: CreateDepositUploadUrlsInput): Promise<DepositUploadUrls> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits/upload-urls`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to get upload URLs"));
  return (await response.json()) as DepositUploadUrls;
}

export async function uploadDepositImage(target: DepositUploadTarget, fileUri: string, contentType: string): Promise<void> {
  const result = await FileSystem.uploadAsync(target.signedUrl, fileUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      "content-type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error("Unable to upload check image. Please try again.");
  }
}

function normalizeDeposit(input: any): Deposit {
  const images = input?.images ?? {};
  const statusValue: DepositStatus = (() => {
    const raw = typeof input?.status === "string" ? input.status.toUpperCase() : "";
    if (raw === "APPROVED" || raw === "DECLINED" || raw === "PENDING_REVIEW") return raw as DepositStatus;
    return "PENDING_REVIEW";
  })();
  return {
    id: String(input?.id ?? ""),
    accountId: String(input?.accountId ?? input?.account_id ?? ""),
    amount: typeof input?.amount === "number" ? input.amount : (input?.amount_cents ?? 0) / 100,
    submittedAt: String(input?.submittedAt ?? input?.submitted_at ?? input?.created_at ?? ""),
    status: statusValue,
    note: typeof input?.note === "string" ? input.note : undefined,
    images: {
      front: images?.front ?? undefined,
      back: images?.back ?? undefined,
    },
  };
}

export async function submitDeposit(input: CreateDepositInput): Promise<Deposit> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify({
      accountId: input.accountId,
      amount: input.amount,
      depositMethod: input.depositMethod,
      depositType: input.depositType,
      note: input.note,
      frontImagePath: input.frontImagePath,
      backImagePath: input.backImagePath,
    }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to submit deposit"));

  return normalizeDeposit(await response.json());
}

export async function fetchDeposits(): Promise<Deposit[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch deposits"));

  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(normalizeDeposit);
}

export async function fetchDeposit(depositId: string): Promise<Deposit> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits/${encodeURIComponent(depositId)}`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to fetch deposit"));
  return normalizeDeposit(await response.json());
}

// ============= ATM LOCATOR =============
export type AtmSearchParams = {
  query?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  openNow?: boolean;
  limit?: number;
};

export async function searchATMs(params: AtmSearchParams = {}): Promise<AtmSearchResponse> {
  const headers = await getAuthHeader();
  const urlParams = new URLSearchParams();
  if (params.query) urlParams.append("query", params.query);
  if (params.latitude !== undefined) urlParams.append("lat", params.latitude.toString());
  if (params.longitude !== undefined) urlParams.append("lng", params.longitude.toString());
  if (params.radiusMiles !== undefined) urlParams.append("radius_miles", params.radiusMiles.toString());
  if (params.openNow !== undefined) urlParams.append("open_now", params.openNow ? "true" : "false");
  if (params.limit !== undefined) urlParams.append("limit", params.limit.toString());
  
  const response = await fetch(`${API_URL}/api/atms/search?${urlParams}`, { headers });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to search ATMs"));
  
  const data = (await response.json()) as AtmSearchResponse;
  return data;
}

// ============= NOTIFICATIONS =============
export async function fetchNotifications(): Promise<any[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/notifications`, { headers });
  if (!response.ok) throw new Error("Failed to fetch notifications");
  
  const data = await response.json();
  return data.map((notif: any) => ({
    id: notif.id,
    type: notif.type || "security",
    title: notif.title || "Notification",
    body: notif.body || "",
    createdAt: notif.created_at,
    read: notif.read || false,
  }));
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/notifications/${notificationId}/read`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error("Failed to mark notification as read");
}
