// Accounts kept in data/accounts.json, keyed by the ThunderID user ID. A user's account is opened with
// a starting balance the first time it is used.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), 'data', 'accounts.json');
const STARTING_BALANCE = 5000;

function load() {
  if (!existsSync(file)) {
    return {};
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function save(accounts) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(accounts, null, 2)}\n`);
}

function openIfNeeded(accounts, userId) {
  if (!accounts[userId]) {
    accounts[userId] = {
      accountNumber: `BNK-${userId.replace(/-/g, '').slice(-5).toUpperCase()}`,
      balance: STARTING_BALANCE,
      transactions: [
        { at: new Date().toISOString(), type: 'credit', amount: STARTING_BALANCE, description: 'Opening balance' },
      ],
    };
  }
  return accounts[userId];
}

export function accountFor(userId) {
  const accounts = load();
  const account = openIfNeeded(accounts, userId);
  save(accounts);
  return account;
}

export function transfer(userId, { amount, to, note, agentId }) {
  const accounts = load();
  const account = openIfNeeded(accounts, userId);
  if (amount > account.balance) {
    return { error: 'insufficient funds' };
  }
  account.balance = Math.round((account.balance - amount) * 100) / 100;
  account.transactions.unshift({
    at: new Date().toISOString(),
    type: 'debit',
    amount,
    description: `Transfer to ${to}${note ? `: ${note}` : ''}`,
    // Set when a personal agent made the transfer for the owner.
    viaAgent: agentId ?? undefined,
  });
  save(accounts);
  return { account };
}
