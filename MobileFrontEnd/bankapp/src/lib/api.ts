import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabaseClient";
import type {
  BankAccount,
  Transaction,
  Payee,
  ScheduledPayment,
  Deposit,
  AtmLocation,
} from "../types";

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

// ============= BILL PAYMENTS =============
export async function fetchPayees(): Promise<Payee[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payees`, { headers });
  if (!response.ok) throw new Error("Failed to fetch payees");
  
  const data = await response.json();
  return data.map((payee: any) => ({
    id: payee.id,
    name: payee.name,
    category: payee.category || "Other",
    accountMask: `...${payee.account_last4}`,
  }));
}

export async function fetchBillPayments(): Promise<ScheduledPayment[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments`, { headers });
  if (!response.ok) throw new Error("Failed to fetch bill payments");
  
  const data = await response.json();
  return data.map((payment: any) => ({
    id: payment.id,
    payeeId: payment.payee_id,
    payeeName: payment.payee_name || "Unknown",
    accountId: payment.account_id,
    amount: payment.amount_cents / 100,
    cadence: payment.cadence.charAt(0).toUpperCase() + payment.cadence.slice(1),
    deliverBy: payment.deliver_by,
    status: payment.status.toUpperCase(),
  }));
}

export async function createBillPayment(
  payeeId: string,
  accountId: string,
  amount: number,
  cadence: "once" | "weekly" | "biweekly" | "monthly",
  deliverBy: string
): Promise<ScheduledPayment> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      payee_id: payeeId,
      account_id: accountId,
      amount_cents: Math.round(amount * 100),
      cadence,
      deliver_by: deliverBy,
    }),
  });
  if (!response.ok) throw new Error("Failed to create bill payment");
  
  const payment = await response.json();
  return {
    id: payment.id,
    payeeId: payment.payee_id,
    payeeName: payment.payee_name || "Unknown",
    accountId: payment.account_id,
    amount: payment.amount_cents / 100,
    cadence: payment.cadence.charAt(0).toUpperCase() + payment.cadence.slice(1),
    deliverBy: payment.deliver_by,
    status: payment.status.toUpperCase(),
  };
}

export async function cancelBillPayment(paymentId: string): Promise<void> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/payments/${paymentId}/cancel`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error("Failed to cancel bill payment");
}

// ============= DEPOSITS =============
export async function getDepositUploadUrls(): Promise<{ front: string; back: string }> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits/upload-urls`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error("Failed to get upload URLs");
  return await response.json();
}

export async function submitDeposit(
  accountId: string,
  amount: number,
  note?: string,
  frontImagePath?: string,
  backImagePath?: string
): Promise<Deposit> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      account_id: accountId,
      amount_cents: Math.round(amount * 100),
      note,
      front_image_path: frontImagePath,
      back_image_path: backImagePath,
    }),
  });
  if (!response.ok) throw new Error("Failed to submit deposit");
  
  const deposit = await response.json();
  return {
    id: deposit.id,
    accountId: deposit.account_id,
    amount: deposit.amount_cents / 100,
    submittedAt: deposit.submitted_at,
    status: deposit.status === "submitted" ? "PENDING_REVIEW" : deposit.status.toUpperCase(),
    note: deposit.note,
    images: {
      front: deposit.front_image_path ? { id: "front", fileName: "front.jpg", capturedAt: deposit.submitted_at } : undefined,
      back: deposit.back_image_path ? { id: "back", fileName: "back.jpg", capturedAt: deposit.submitted_at } : undefined,
    },
  };
}

export async function fetchDeposits(): Promise<Deposit[]> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/deposits`, { headers });
  if (!response.ok) throw new Error("Failed to fetch deposits");
  
  const data = await response.json();
  return data.map((deposit: any) => ({
    id: deposit.id,
    accountId: deposit.account_id,
    amount: deposit.amount_cents / 100,
    submittedAt: deposit.submitted_at,
    status: deposit.status === "submitted" ? "PENDING_REVIEW" : deposit.status.toUpperCase(),
    note: deposit.note,
    images: {
      front: deposit.front_image_path ? { id: "front", fileName: "front.jpg", capturedAt: deposit.submitted_at } : undefined,
      back: deposit.back_image_path ? { id: "back", fileName: "back.jpg", capturedAt: deposit.submitted_at } : undefined,
    },
  }));
}

// ============= ATM LOCATOR =============
export async function searchATMs(
  query?: string,
  latitude?: number,
  longitude?: number
): Promise<AtmLocation[]> {
  const headers = await getAuthHeader();
  const params = new URLSearchParams();
  if (query) params.append("query", query);
  if (latitude !== undefined) params.append("latitude", latitude.toString());
  if (longitude !== undefined) params.append("longitude", longitude.toString());
  
  const response = await fetch(`${API_URL}/api/atms/search?${params}`, { headers });
  if (!response.ok) throw new Error("Failed to search ATMs");
  
  const data = await response.json();
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
