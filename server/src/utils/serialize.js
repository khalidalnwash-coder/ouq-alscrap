function serializeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    full_name: u.full_name,
    account_type: u.account_type,
    phone_country_code: u.phone_country_code,
    phone_number: u.phone_number,
    email: u.email,
    age: u.age,
    country: u.country,
    otp_verified_channel: u.otp_verified_channel,
    verified_at: u.verified_at,
    terms_accepted_at: u.terms_accepted_at,
    notifications_enabled: u.notifications_enabled,
    is_verified_trader: u.is_verified_trader,
    is_admin: u.is_admin,
    rating_avg: Number(u.rating_avg),
    completed_deals_count: u.completed_deals_count,
    status: u.status,
    created_at: u.created_at,
  };
}

module.exports = { serializeUser };
