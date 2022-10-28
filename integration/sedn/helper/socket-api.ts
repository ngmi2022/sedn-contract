import { BigNumber, ethers } from "ethers";
import fetch from "node-fetch";

import { GetQuote, GetTx, Route, registryAbiOutboundTransfer } from "./interfaces";

class SocketApi {
  apiKey: string;

  constructor(theApiKey: string) {
    this.apiKey = theApiKey;
  }

  async request(methodUrl: string) {
    try {
      // 👇️ const response: Response
      const response = await fetch(methodUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "API-KEY": this.apiKey,
        },
      });
      if (!response.ok) {
        throw new Error(`Error! status: ${response.status}`);
      }
      const result = await response.json();
      return result;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error message: ", error.message);
        return error.message;
      } else {
        console.log("unexpected error: ", error);
        return "An unexpected error occurred";
      }
    }
  }
  async push(methodUrl: string, bodyContent: string) {
    try {
      // 👇️ const response: Response
      const response = await fetch(methodUrl, {
        method: "POST",
        headers: {
          "API-KEY": this.apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: bodyContent,
      });
      if (!response.ok) {
        throw new Error(`Error! status: ${response.status}`);
      }
      const result = await response.json();
      return result;
    } catch (error) {
      if (error instanceof Error) {
        console.log("error message: ", error.message);
        return error.message;
      } else {
        console.log("unexpected error: ", error);
        return "An unexpected error occurred";
      }
    }
  }
  async getQuote(
    fromChainId: number,
    fromTokenAddress: string,
    toChainId: number,
    toTokenAddress: string,
    fromAmount: number,
    userAddress: string,
    uniqueRoutesPerBridge: boolean,
    sort: string,
    recipient?: string,
    singleTxOnly?: boolean,
  ) {
    const methodUrl: string = `https://api.socket.tech/v2/quote?fromChainId=${fromChainId}&fromTokenAddress=${fromTokenAddress}&toChainId=${toChainId}&toTokenAddress=${toTokenAddress}&fromAmount=${fromAmount}&userAddress=${userAddress}&uniqueRoutesPerBridge=${uniqueRoutesPerBridge}&sort=${sort}&recipient=${recipient}&singleTxOnly=${singleTxOnly}`;
    const result = await this.request(methodUrl);
    return result;
  }
  async buildTx(route: Route) {
    const methodUrl = "https://api.socket.tech/v2/build-tx";
    const strRoute = JSON.stringify({ route });
    const result = await this.push(methodUrl, strRoute);
    return result;
  }

  async buildTxManually(
    sender: string,
    recipient: string,
    routePath: string,
    fromChainId: number,
    toChainId: number,
    fromTokenAddress: string,
    toTokenAddress: string,
    fromAmount: number,
    toAmount: number,
    bridgeInputTokenAddress: string,
  ) {
    const methodUrl: string = `https://api.socket.tech/v2/build-tx?sender=${sender}&recipient=${recipient}&routePath=${routePath}&fromChainId=${fromChainId}&toChainId=${toChainId}&fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&fromAmount=${fromAmount}&toAmount=${toAmount}&bridgeInputTokenAddress=${bridgeInputTokenAddress}`;
    // console.log(methodUrl);
    const result = await this.request(methodUrl);
    // console.log(result);
    return result;
  }
}

async function getUserRequestDictionary(txResult: GetTx) {
  const txData: string = txResult.result.txData;
  const iFace = new ethers.utils.Interface(registryAbiOutboundTransfer);
  const jsonTxData = JSON.stringify(iFace.decodeFunctionData("outboundTransferTo", txData)[0]);
  const txDataDecoded = JSON.parse(jsonTxData);
  // User Request necessary shit
  const receiverAddress: string = txDataDecoded[0];
  const toChainId: number = BigNumber.from(txDataDecoded[1]).toNumber();
  const fromAmount: number = BigNumber.from(txDataDecoded[2]).toNumber();
  // MiddlewareRequest necessary shit
  const miWaId: number = BigNumber.from(txDataDecoded[3][0]).toNumber();
  const miWaOptionalNativeAmount: number = BigNumber.from(txDataDecoded[3][1]).toNumber();
  const miWaInputToken: string = txDataDecoded[3][2];
  const miWaData: string = txDataDecoded[3][3];
  const middlewareRequest = [miWaId, miWaOptionalNativeAmount, miWaInputToken, miWaData];
  // bridgeRequest necessary shit
  const briId: number = BigNumber.from(txDataDecoded[4][0]).toNumber();
  const briOptionalNativeAmount: number = BigNumber.from(txDataDecoded[4][1]).toNumber();
  const briInputToken: string = txDataDecoded[4][2];
  const briData: string = txDataDecoded[4][3];
  const bridgeRequest = [briId, briOptionalNativeAmount, briInputToken, briData];
  // compile dictionary
  const requestDict: any = {
    receiverAddress: receiverAddress,
    toChainId: toChainId,
    amount: fromAmount,
    middlewareRequest: middlewareRequest,
    bridgeRequest: bridgeRequest,
  };
  //   console.log(requestDict);
  return requestDict;
}

export { SocketApi, getUserRequestDictionary };
