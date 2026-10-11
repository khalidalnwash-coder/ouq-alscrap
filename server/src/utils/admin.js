// Single source of truth for "who is the admin" — driven entirely by the
// ADMIN_EMAIL environment variable (set in Render, never committed), not by
// a stored DB flag. If the variable is empty/unset, nobody is an admin,
// even if a users.is_admin row was set true by some older manual promotion.
// Read fresh on every call (not cached at startup) so changing the env var
// and restarting the server is enough — no code change needed.
function isAdminEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!adminEmail) return false;
  return (email || '').trim().toLowerCase() === adminEmail;
}

module.exports = { isAdminEmail };
