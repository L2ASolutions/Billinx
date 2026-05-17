import { ForbiddenException } from '@nestjs/common';

// Hierarchy from highest to lowest privilege
const ROLE_ORDER = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;
type Role = (typeof ROLE_ORDER)[number];

function roleRank(role: string): number {
  const idx = ROLE_ORDER.indexOf(role as Role);
  return idx === -1 ? 999 : idx; // Unknown roles get lowest rank
}

/**
 * Throws ForbiddenException if the actor's role is lower than requiredRole.
 *
 * @param actorRoles  Array of role strings the actor holds (from UserRole[])
 * @param requiredRole  Minimum role required to perform the action
 */
export function checkRole(actorRoles: string[], requiredRole: Role): void {
  const bestRank = Math.min(...actorRoles.map(roleRank));
  const requiredRank = roleRank(requiredRole);

  if (bestRank > requiredRank) {
    throw new ForbiddenException(
      `This action requires ${requiredRole} role or higher`,
    );
  }
}

/**
 * Returns true if the actor has at least the required role.
 */
export function hasRole(actorRoles: string[], requiredRole: Role): boolean {
  const bestRank = Math.min(...actorRoles.map(roleRank));
  return bestRank <= roleRank(requiredRole);
}
