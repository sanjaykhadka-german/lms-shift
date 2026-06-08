export type Plan = "free" | "starter" | "pro" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

// Apps in the Tracey suite that a tenant can subscribe to independently.
// Each (tenant, app) pair has its own subscription row (see
// packages/db tenant_subscriptions). 'lms' is the historical default.
export type App = "lms" | "shiftcraft";
export const APPS: readonly App[] = ["lms", "shiftcraft"] as const;
