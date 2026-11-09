const TICKET_KEY = /^T(\d{1,9})$/i;

export function nextTicketNumber(usedKeys: Iterable<string>): string {
  let highest = 0;
  for (const key of usedKeys) {
    const match = TICKET_KEY.exec(String(key).trim());
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
  }
  return formatTicket(highest + 1);
}

export function bumpTicket(ticket: string): string {
  return formatTicket(Number(ticket.slice(1)) + 1);
}

function formatTicket(number: number): string {
  return `T${String(number).padStart(3, '0')}`;
}
