import { BigNumber, BigNumberish, Contract, Wallet } from "ethers";

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
  args: IKnownArgs | IUnknownArgs | IBridgeWithdrawArgs; // arguments to pass to the method
  solution?: string; // solution to the secret
  signedTx?: string;
  from?: string; // signer address
}

export interface IKnownArgs {
  _amount: BigNumberish;
  to: string;
  balanceAmount?: BigNumberish;
}

export interface IUnknownArgs {
  _amount: BigNumberish;
  secret: string;
  balanceAmount?: BigNumberish;
}

export interface IBridgeWithdrawArgs {
  _amount: BigNumberish;
  balanceAmount?: BigNumberish;
  userRequest: IBridgeUserRequest;
  bridgeImpl: string;
}

export interface IBridgeUserRequest {
  receiverAddress: string;
  toChainId: number;
  amount: BigNumberish;
  middleWareRequest: IBridgeMiddleWareRequest;
  BridgeRequest: IBridgeRequest;
}

export interface IBridgeMiddleWareRequest {
  id: string;
  optionalNativeAmount: BigNumberish;
  inputToken: string;
  data: string;
}

export interface IBridgeRequest {
  id: string;
  optionalNativeAmount: BigNumberish;
  inputToken: string;
  data: string;
}

export interface IExecution {
  status: string;
  type: string;
  amount: string;
  recipient: string;
  transactions: ITransaction[];
  userId: string;
}

export interface IExecutionsResponse {
  executions: IExecution[];
}

export interface IExecuteTransactionRequest {
  transactions: ITransaction[];
  environment?: string;
  type: string; // send or withdraw
  recipientIdOrAddress: string; // TODO: remove this later as this API is auth gated
}

export interface IExecutionStatusRequest {
  executionId: string;
}
