export const SECURITY_CLAIMS = [
  'canChat',
  'canEmployeeDocs',
  'canBusinessDocs',
  'canFleetDocs',
  'canPartyBanks',
  'canCalendar',
  'canOwnerBills',
  'canFiscalRead',
  'canFiscalWrite',
  'canReceivables',
  'canPasswords',
  'canSupport',
  'canPurchasing',
  'canSales',
  'canQuickEntry',
  'canInventory',
  'canCustomers',
  'canSuppliers',
  'canAdvances',
  'canPayables',
  'canExpenses',
  'canFinance',
  'canBanking',
  'canPayroll',
  'canHR',
  'canFleet',
  'canContracts',
  'canShoppingList',
  'canTasks',
  'canDeliveryAgenda',
  'canCoordination',
] as const;

export type SecurityClaim = (typeof SECURITY_CLAIMS)[number];

export type SecurityClaims = Record<SecurityClaim, boolean>;

export type Identity = Partial<SecurityClaims> & {
  uid?: string;
  erpUser?: string;
  erpAccess?: boolean;
  admin?: boolean;
  engineer?: boolean;
};

export function actorKey(identity: Identity, fallback = 'user'): string {
  return String(identity.uid || identity.erpUser || fallback).replace(/[^\w-]/g, '_');
}
