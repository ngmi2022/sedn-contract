export interface GetQuote {
  success: boolean;
  result: Result;
}

export interface Result {
  routes: Route[];
  fromChainID: number;
  fromAsset: Asset;
  toChainID: number;
  toAsset: Asset;
  bridgeRouteErrors: BridgeRouteErrors;
}

export interface BridgeRouteErrors {
  refuelBridge: RefuelBridge;
  polygonBridge: Across;
  arbitrumBridge: Across;
  hop: Across;
  across: Across;
  optimismBridge: Across;
}

export interface Across {
  status: string;
}

export interface RefuelBridge {
  status: string;
  maxAmount: string;
}

export interface Asset {
  chainID: number;
  address: string;
  symbol: Symbol;
  name: FromAssetName;
  decimals: number;
  icon: string;
  logoURI: string;
  chainAgnosticID: Symbol | null;
}

export enum Symbol {
  Bnb = "BNB",
  Dai = "DAI",
  Eth = "ETH",
  Matic = "MATIC",
  Usdc = "USDC",
  Usdt = "USDT",
  Weth = "WETH",
}

export enum FromAssetName {
  BinancePegUSDCoin = "Binance-Peg USD Coin",
  Bnb = "BNB",
  DaiStablecoin = "Dai Stablecoin",
  DaiToken = "Dai Token",
  EthereumToken = "Ethereum Token",
  Matic = "MATIC",
  TetherUSD = "Tether USD",
  USDCoin = "USDCoin",
  WrappedEther = "Wrapped Ether",
}

export interface Route {
  routeID: string;
  isOnlySwapRoute: boolean;
  fromAmount: string;
  toAmount: string;
  usedBridgeNames: UsedBridgeNameElement[];
  minimumGasBalances: { [key: string]: string };
  chainGasBalances: { [key: string]: ChainGasBalance };
  totalUserTx: number;
  sender: Recipient;
  recipient: Recipient;
  totalGasFeesInUsd: number;
  userTxs: UserTx[];
  serviceTime: number;
  maxServiceTime: number;
  integratorFee: IntegratorFee;
}

export interface ChainGasBalance {
  minGasBalance?: string;
  hasGasBalance?: boolean;
}

export interface IntegratorFee {
  amount?: string;
  asset?: Asset;
}

export enum Recipient {
  The0X3E8CB4Bd04D81498AB4B94A392C334F5328B237B = "0x3e8cB4bd04d81498aB4b94a392c334F5328b237b",
}

export enum UsedBridgeNameElement {
  AnyswapRouterV4 = "anyswap-router-v4",
  Celer = "celer",
  Hyphen = "hyphen",
  Oneinch = "oneinch",
}

export interface UserTx {
  userTxType: UserTxType;
  txType: TxType;
  chainID: number;
  toAmount: string;
  toAsset: Asset;
  stepCount: number;
  routePath: string;
  sender: Recipient;
  approvalData: ApprovalData;
  steps: Step[];
  gasFees: GasFees;
  serviceTime: number;
  recipient: Recipient;
  maxServiceTime: number;
  bridgeSlippage: number;
  userTxIndex: number;
  swapSlippage: number;
  protocol: UserTxProtocol;
  fromAsset: Asset;
  fromAmount: string;
  minAmountOut: string;
}

export interface ApprovalData {
  minimumApprovalAmount?: string;
  approvalTokenAddress?: string;
  allowanceTarget?: string;
  owner?: Recipient;
}

export interface GasFees {
  gasAmount?: string;
  feesInUsd?: number;
  asset?: Asset;
  gasLimit?: number;
}

export interface UserTxProtocol {
  name?: UsedBridgeNameElement;
  displayName?: DisplayName;
  icon?: string;
}

export enum DisplayName {
  Celer = "Celer",
  Hyphen = "Hyphen",
  Multichain = "Multichain",
  The1Inch = "1Inch",
}

export interface Step {
  type?: Type;
  protocol?: StepProtocol;
  fromChainID?: number;
  fromAsset?: Asset;
  fromAmount?: string;
  toChainID?: number;
  toAsset?: Asset;
  toAmount?: string;
  bridgeSlippage?: number;
  minAmountOut?: string;
  protocolFees?: ProtocolFees;
  gasFees?: GasFees;
  serviceTime?: number;
  maxServiceTime?: number;
  swapSlippage?: number;
  chainID?: number;
}

export interface StepProtocol {
  name?: UsedBridgeNameElement;
  displayName?: DisplayName;
  icon?: string;
  securityScore?: number;
  robustnessScore?: number;
}

export interface ProtocolFees {
  asset?: Asset;
  feesInUsd?: number;
  amount?: string;
}

export enum Type {
  Bridge = "bridge",
  Middleware = "middleware",
}

export enum TxType {
  EthSendTransaction = "eth_sendTransaction",
}

export enum UserTxType {
  DexSwap = "dex-swap",
  FundMovr = "fund-movr",
}

export interface GetTx {
  status: boolean;
  result: Result;
}

export interface Result {
  userTxType: string;
  txTarget: string;
  chainID: string;
  txData: string;
  txType: string;
  value: string;
  totalUserTx: number;
  approvalData: ApprovalData;
}

export interface ApprovalData {
  minimumApprovalAmount?: string;
  approvalTokenAddress?: string;
  allowanceTarget?: string;
  owner?: Recipient;
}

const registryAbiOutboundTransferJson = [
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "receiverAddress",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "toChainId",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "id",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "optionalNativeAmount",
                type: "uint256",
              },
              {
                internalType: "address",
                name: "inputToken",
                type: "address",
              },
              {
                internalType: "bytes",
                name: "data",
                type: "bytes",
              },
            ],
            internalType: "struct Registry.MiddlewareRequest",
            name: "middlewareRequest",
            type: "tuple",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "id",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "optionalNativeAmount",
                type: "uint256",
              },
              {
                internalType: "address",
                name: "inputToken",
                type: "address",
              },
              {
                internalType: "bytes",
                name: "data",
                type: "bytes",
              },
            ],
            internalType: "struct Registry.BridgeRequest",
            name: "bridgeRequest",
            type: "tuple",
          },
        ],
        internalType: "struct Registry.UserRequest",
        name: "_userRequest",
        type: "tuple",
      },
    ],
    name: "outboundTransferTo",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];
export const registryAbiOutboundTransfer = JSON.stringify(registryAbiOutboundTransferJson);
