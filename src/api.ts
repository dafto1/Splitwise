import type { AuthResponse, Expense, Group, GroupSummary, Member, Message, Settlement, User, UserSuggestion } from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("splitly_token");
  const response = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Something went wrong. Please try again.");
  return response.json();
}
export const api = {
  signUp: (name: string, email: string, password: string) => request<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  signIn: (email: string, password: string) => request<AuthResponse>("/auth/signin", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<User>("/auth/me"),
  signOut: () => request<void>("/auth/signout", { method: "POST" }),
  searchUsers: (query: string) => request<UserSuggestion[]>(`/users/search?q=${encodeURIComponent(query)}`),
  groups: () => request<GroupSummary[]>("/groups"),
  createGroup: (name: string, memberIds: string[]) => request<Group>("/groups", { method: "POST", body: JSON.stringify({ name, memberIds }) }),
  group: (id: string) => request<Group>(`/groups/${id}`),
  addMember: (id: string, userId: string) => request<Member>(`/groups/${id}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
  addExpense: (id: string, expense: Omit<Expense, "id" | "createdAt">) => request<Expense>(`/groups/${id}/expenses`, { method: "POST", body: JSON.stringify(expense) }),
  balances: (id: string) => request<{ userId: string; amount: number }[]>(`/groups/${id}/balances`),
  settlements: (id: string) => request<Settlement[]>(`/groups/${id}/settlements`),
  settle: (id: string, data: Pick<Settlement, "fromUserId" | "toUserId" | "amount">) => request<Settlement>(`/groups/${id}/settlements`, { method: "POST", body: JSON.stringify(data) }),
  messages: (id: string) => request<Message[]>(`/groups/${id}/messages`),
  sendMessage: (id: string, userId: string, content: string) => request<Message>(`/groups/${id}/messages`, { method: "POST", body: JSON.stringify({ userId, content }) })
};
