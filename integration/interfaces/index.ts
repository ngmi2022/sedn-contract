import { BigNumber, Contract, Wallet } from "ethers";

import { FakeSigner } from "../../helper/FakeSigner";

export interface IGetRouteRequest {
  fromChain: string;
  toChain: string;
  recipientAddress: string;
  amount: string;
}

export interface IGetRouteResponse {
  request: any;
  bridgeAddress: string;
  value?: string;
}

export interface IWireRequest {
  senderAddress: string;
  amount: number;
  recipientId: string; // phone for now
  environment?: string;
  testnet?: boolean;
}

export interface IWireResponse {
  type: string;
  transactions: ITransaction[];
}

export interface IWithdrawRequest {
  senderAddress: string;
  totalAmount: number;
  recipientAddress: string;
  recipientNetwork: string;
  withdrawals: IChainWithdraw[];
  excludeBridges?: string;
  useStargate?: boolean;
  environment?: string;
}

export interface IChainWithdraw {
  network: string;
  amount: number;
}

export interface ITransaction {
  type: string; // "sendKnown" or "sendUnknown"
  chainId: number; // chainId of the chain
  to: string; // recipient address or mobile number
  value: string; // amount to send in USDC, big number
  method: string; // method to call on the contract, either sendKnown, sendHybridKnown, sendUnknown sendHybridUnknown
  socketRoute?: IGetRouteResponse;
  signedTx?: string;
  from?: string; // signer address
}

