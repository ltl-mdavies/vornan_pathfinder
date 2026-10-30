/** Presentation gate only. The API independently checks verified-user grants. */
export function catalogAvailable(flag: string | undefined, customers: string | undefined, selected: string, authenticated: boolean) {
  return flag === 'true' && authenticated && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(selected) &&
    (customers ?? '').split(',').map(id => id.trim()).includes(selected);
}
