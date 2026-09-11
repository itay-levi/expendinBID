/**
 * Public identity and contact details, in one place so the legal pages, receipts copy and UI can
 * never quote different addresses. Previously duplicated as a literal in each legal page.
 */
export const SITE_NAME = 'Hex Wars'

/** Override with NEXT_PUBLIC_SUPPORT_EMAIL; it is shown to buyers, so it is public by design. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || 'support@hexwars.io'
