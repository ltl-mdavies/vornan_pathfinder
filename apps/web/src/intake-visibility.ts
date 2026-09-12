export function isIntakeVisibilityAvailable(flag: string | undefined, customer: string | undefined, selectedCustomer: string, authenticated: boolean) {
  return flag === "true" && authenticated && !!customer && customer === customer.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(customer) && selectedCustomer === customer;
}
