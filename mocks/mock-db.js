'use strict';

/** TEMPORARY stand-in for Group 2's db.js. In-memory only. Delete once Group 2 lands. */

let rows = [];
let seq = 0;

async function insertTransaction(txn) {
  seq += 1;
  const row = { id: seq, ...txn };
  rows.push(row);
  return { ...row };
}

async function getAllTransactions() {
  return rows.map((r) => ({ ...r }));
}

function reset() {
  rows = [];
  seq = 0;
}

module.exports = { insertTransaction, getAllTransactions, reset };
