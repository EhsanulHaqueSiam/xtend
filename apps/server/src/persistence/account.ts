/**
 * SQL for the current account id. Stores compare `account_id` against it
 * (`AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`), so switching accounts
 * is one UPDATE on settings and no store needs a new dependency.
 */
export const CURRENT_ACCOUNT = "(SELECT current_account_id FROM settings WHERE id = 1)";
