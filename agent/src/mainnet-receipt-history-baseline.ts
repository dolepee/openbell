import { parseReceiptBoundHistorySnapshot } from "./receipt-bound-history.js";

export const MAINNET_RECEIPT_HISTORY_BASELINE = parseReceiptBoundHistorySnapshot({
  schemaVersion: "openbell-receipt-bound-history-v1",
  chainId: 196,
  receivables: "0xc4Ef249b80a6a034198C226278c51b0a903840dd",
  payer: "0xbad35FA6e368e90fC4faf63507F2D0A2Fdf94BAF",
  fromBlock: "67764503",
  throughBlock: "68230450",
  throughBlockHash: "0xa4f0a9b4f8e4cdd3adadb8ef187b28155f049e70100dc8294aa16852d66daf80",
  completedSettlements: 1,
  onTimeSettlements: 1,
  lateSettlements: 0,
  activeFunded: 0,
  overdueFunded: 0,
  counterpartyConcentrationBps: 7142,
  daysSinceLastSettlement: 0,
  invoiceIds: [
    "0x97b5a9424799a02e456e73bad442e65545334cad44ee6b24f73c437d35767d88",
    "0xd2d05e432f15d248418412260dff78e75611f00ac164dd6ea650d35735c2c60c"
  ],
  historyCommitment: "0x42be4b2330dd65653d9e4a9de9f03175ef8daf46b7fed2c75fba4ca1c9464e1a"
});
