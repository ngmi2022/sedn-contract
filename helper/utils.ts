import { TransactionReceipt, TransactionResponse } from "@ethersproject/providers";
import axios from "axios";
import { fetch } from "cross-fetch";
import { config } from "dotenv";
import { BigNumber, Contract, Wallet, ethers } from "ethers";
import { ITransaction } from "sedn-interfaces";

import { FakeSigner } from "./FakeSigner";
import { getSignedTxRequest } from "./signer";

import path = require("path");

// get dem fucking env's up in this bitch
config({ path: path.resolve(__dirname, "../.env") });

// TODO: Add to interfaces
export interface INetworkScenarios {
  [network: string]: IScenario;
}

export interface IScenario {
  sedn: BigNumber;
  usdc: BigNumber;
}

export const fetchConfig = async () => {
  const ENVIRONMENT = process.env.ENVIRONMENT;
  if (ENVIRONMENT === "staging") {
    return await (
      await fetch("https://storage.googleapis.com/sedn-public-config/v2.staging.config.json?avoidTheCaches=1")
    ).json();
  }
  return await (
    await fetch("https://storage.googleapis.com/sedn-public-config/v2.config.json?avoidTheCaches=1")
  ).json();
};

export const getTxCostInUSD = async (receipt: any, network: string) => {
  const config = await fetchConfig();
  let nativeAmount: string;
  // Gas price part
  switch (network) {
    case "optimism-goerli":
      nativeAmount = ethers.utils.formatEther(receipt.gasUsed); // apparently optimism-goerli is always 1 wei
      break;
    case "optimism":
      nativeAmount = ethers.utils.formatEther(receipt.effectiveGasPrice.mul(receipt.gasUsed));
      break;
    default:
      nativeAmount = ethers.utils.formatEther(receipt.effectiveGasPrice.mul(receipt.gasUsed));
  }
  console.log("TX: Native cost:", nativeAmount);

  // USD Price part
  const assetId = config.nativeAssetIds[network];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd`;
  const priceData = await fetch(url).then(reponse => reponse.json());
  const actualDollarValue = parseFloat(nativeAmount) * priceData[assetId].usd;
  return actualDollarValue.toString() + " USD";
};

export const checkTxStatus = async (receipt: TransactionReceipt) => {
  const logs = receipt.logs || [];
  if (typeof logs === "undefined" || logs.length === 0) {
    throw new Error("Transaction executed, but reverted");
  }
};

export const getTxReceipt = async (maxTimeMs: number, signer: Wallet, txHash: string) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const txReceipt = await signer.provider.getTransactionReceipt(txHash);
    const elapsedTimeMs = new Date().getTime() - startDate;

    if (txReceipt) {
      return resolve(txReceipt);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`TX Receipt long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(`Waiting for tx receipt. Elapsed time: ${elapsedTimeMs}ms.`);
      setTimeout(executePoll, 5000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

// Infura URL
export const getRpcUrl = (network: string) => {
  const infuraKey: string = process.env.INFURA_API_KEY as string;
  switch (network) {
    case "mainnet":
      return "https://mainnet.infura.io/v3/" + infuraKey;
    case "polygon":
      return "https://polygon-mainnet.infura.io/v3/" + infuraKey;
    case "arbitrum":
      return "https://arbitrum-mainnet.infura.io/v3/" + infuraKey;
    case "goerli":
      return "https://goerli.infura.io/v3/" + infuraKey;
    case "sepolia":
      return "https://sepolia.infura.io/v3/" + infuraKey;
    case "arbitrum-goerli":
      // return "https://arb-goerli.g.alchemy.com/v2/5C_40-DhRANBfyqC-U4nh0m3uQWw6uj7";
      return "https://arbitrum-goerli.infura.io/v3/" + infuraKey;
    case "optimism":
      return "https://optimism-mainnet.infura.io/v3/" + infuraKey;
    case "optimism-goerli":
      return "https://opt-goerli.g.alchemy.com/v2/EeTaU4XMkH0OLUyZPPbCTsXijHTe7NqW";
    // return "https://optimism-goerli.infura.io/v3/" + infuraKey;
    default:
      throw new Error("Network not supported: Infura");
  }
};

export const explorerData: any = {
  mainnet: {
    url: "https://etherscan.com",
    api: "https://api.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY!,
  },
  polygon: {
    url: "https://polygonscan.com",
    api: "https://api.polygonscan.com/api",
    apiKey: process.env.POLYGONSCAN_API_KEY!,
  },
  arbitrum: {
    url: "https://arbiscan.io",
    api: "https://api.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY!,
  },
  goerli: {
    url: "https://goerli.etherscan.io",
    api: "https://api-goerli.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY!,
  },
  sepolia: {
    url: "https://sepolia.etherscan.io",
    api: "https://api-sepolia.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY!,
  },
  "arbitrum-goerli": {
    url: "https://goerli.arbiscan.io/",
    api: "https://api-goerli.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY!,
  },
  optimism: {
    url: "https://optimistic.etherscan.io/",
    api: "https://api-optimistic.etherscan.io/",
    apiKey: process.env.OPTIMISM_API_KEY!,
  },
  "optimism-goerli": {
    url: "https://goerli-optimism.etherscan.io/",
    api: "https://api-goerli-optimistic.etherscan.io/api",
    apiKey: process.env.OPTIMISM_API_KEY!,
  },
};

// standardized method of getting etherscan-based abi's
export const getAbi = async (network: string, contract: string) => {
  if (explorerData[network] === undefined) {
    throw new Error("Network not supported: explorerData");
  }
  const apiUrl = explorerData[network].api;
  const apiKey = explorerData[network].apiKey;

  if (!apiKey) {
    throw new Error(`API Key for ${network} is not defined`);
  }
  // console.log(`${apiUrl}?module=contract&action=getabi&address=${contract}&apikey=${apiKey}`);
  const data: any = await (
    await fetch(`${apiUrl}?module=contract&action=getabi&address=${contract}&apikey=${apiKey}`)
  ).json();
  return JSON.parse(data.result);
};

export const feeData = async (network: string, signer: Wallet) => {
  let fees: any = {};
  switch (network) {
    case "polygon":
      fees = await fetch("https://gasstation-mainnet.matic.network/v2").then(response => response.json());
      console.log("INFO: Polygon fee market is used");
      return {
        maxFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxFee) + "", "gwei"),
        maxPriorityFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxPriorityFee) + "", "gwei"),
      };
    case "matic":
      fees = await fetch("https://gasstation-mainnet.matic.network/v2").then(response => response.json());
      console.log("INFO: Polygon fee market is used");
      return {
        maxFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxFee) + "", "gwei"),
        maxPriorityFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxPriorityFee) + "", "gwei"),
      };
    default:
      const feesData = await signer.provider?.getFeeData();
      console.log("INFO: Standard fee market is used");
      return {
        maxFee: feesData.maxFeePerGas,
        maxPriorityFee: feesData.maxPriorityFeePerGas,
      };
  }
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function shuffle<T>(array: T[]): T[] {
  let currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }

  return array;
}

export const getChainFromId = (chainId: number) => {
  switch (chainId) {
    case 1:
      return "mainnet";
    case 137:
      return "polygon-mainnet";
    case 42161:
      return "arbitrum";
    case 421613:
      return "arbitrum-goerli";
    case 100:
      return "gnosis";
    case 11155111:
      return "sepolia";
    case 10:
      return "optimism";
    case 420:
      return "optimism-goerli";
    default:
      throw new Error(`ChainId ${chainId} not supported`);
  }
};

export const getChainId = (network: string) => {
  switch (network) {
    case "mainnet":
      return "1";
    case "polygon":
    case "polygon-mainnet":
    case "matic":
      return "137";
    case "arbitrum":
      return "42161";
    case "arbitrum-goerli":
      return "421613";
    case "gnosis":
      return "100";
    case "sepolia":
      return "11155111";
    case "optimism":
    case "optimism-mainnet":
      return "10";
    case "optimism-goerli":
      return "420";
    default:
      throw new Error(`Network ${network} not supported`);
  }
};

export const getMin = function (a: BigNumber, b: BigNumber) {
  return a.lt(b) ? a : b;
};

export const getMax = function (a: BigNumber, b: BigNumber) {
  return a.gt(b) ? a : b;
};

export const getRandomRecipientNetwork = async (fromNetwork: string, destinationNetworks: string[]) => {
  const networks = destinationNetworks.filter(network => network !== fromNetwork);
  const randomIndex = Math.floor(Math.random() * networks.length);
  return networks[randomIndex];
};

export const waitTillRecipientBalanceIncreased = async (
  maxTimeMs: number,
  contract: Contract,
  recipient: Wallet,
  initialBalance: BigNumber,
  decDivider: number,
  recipientNetwork: string,
) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const newBalance = await contract.balanceOf(recipient.address);
    const elapsedTimeMs = new Date().getTime() - startDate;

    const claimed = newBalance.sub(initialBalance).toNumber();
    if (claimed > 0) {
      return resolve(claimed);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`TX: Exchange took too long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(
        `TX: Waiting for recipient balance to increase. Elapsed time: ${elapsedTimeMs}ms. ${recipientNetwork}:${
          recipient.address
        } balance: ${newBalance.toNumber() / decDivider}`,
      );
      setTimeout(executePoll, 10000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

export const waitTillRecipientBalanceChanged = async (
  maxTimeMs: number,
  contract: Contract,
  signer: Wallet,
  initialBalance: BigNumber,
) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const newBalance = await contract.balanceOf(signer.address);
    const elapsedTimeMs = new Date().getTime() - startDate;

    const claimed = newBalance.sub(initialBalance).toNumber();
    if (claimed != 0) {
      return resolve(claimed);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`TX: Exchange took too long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(
        `TX: Waiting for recipient balance to change. Elapsed time: ${elapsedTimeMs}ms. ${
          signer.address
        } balance: ${newBalance.toNumber()}`,
      );
      setTimeout(executePoll, 10000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

export const checkAllowance = async (usdcOrigin: Contract, signer: Wallet, sedn: Contract, amount: BigNumber) => {
  // check allowance & if necessary increase approve
  const allowance = await usdcOrigin.allowance(signer.address, sedn.address);
  console.log(
    `INFO: current allowance ${allowance.toString()} for signer ${signer.address} and contract ${
      sedn.address
    } on network ${(await signer.provider.getNetwork()).name}.`,
  );
  if (allowance.lt(amount)) {
    const increasedAllowance = amount.sub(allowance);
    const approve = await usdcOrigin.connect(signer).increaseAllowance(sedn.address, increasedAllowance);
    await approve.wait();
    console.log("INFO: Allowance increased");
  }
  return true;
};

export const checkFunding = async (
  usdcOrigin: Contract,
  signer: Wallet,
  recipient: Wallet,
  sedn: Contract,
  amount: number,
) => {
  // check and adapt funding balances of signer
  const sednBalanceSigner = parseInt((await sedn.connect(signer).balanceOf(signer.address)).toString()); // make sure its number
  const sednBalanceRecipient = parseInt((await sedn.connect(signer).balanceOf(recipient.address)).toString()); // make sure its number
  let useSigner = signer;
  let useRecipient = recipient;
  console.log(
    `INFO: Signer has ${sednBalanceSigner / 10 ** 6} USDC on sedn, Recipient has ${
      sednBalanceRecipient / 10 ** 6
    } USDC on sedn; Needed amount ${amount / 10 ** 6}`,
  );
  if (sednBalanceSigner < amount) {
    if (sednBalanceRecipient >= amount) {
      // swap signer and recipient
      useSigner = recipient;
      useRecipient = signer;
      console.log("INFO: Switched signers");
    } else {
      // check allowance & if necessary increase approve
      const allowanceChecked = await checkAllowance(usdcOrigin, signer, sedn, BigNumber.from(amount)); // check allowance
      const fees = await feeData((await signer.provider.getNetwork()).name, signer);
      const txSend = await sedn.connect(signer).sednKnown(amount, signer.address, {
        maxFeePerGas: fees.maxFee,
        maxPriorityFeePerGas: fees.maxPriorityFee,
      }); // fund signer w/o testing
      await txSend.wait();
      await waitTillRecipientBalanceChanged(60_000, sedn, signer, BigNumber.from(sednBalanceSigner.toString()));
      console.log("INFO: Funded signer");
    }
  }
  return [useSigner, useRecipient];
};

export const generateSecret = function () {
  const solution = (Math.random() + 1).toString(36).substring(7);
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  console.log(`INFO: Running with solution '${solution}' and secret '${secret}'`);
  return [solution, secret];
};

export const generateClaimArgs = async (
  solution: string,
  secret: string,
  recipient: Wallet,
  trusted: FakeSigner,
  amount: number,
) => {
  const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
  const signedMessage = await trusted.signMessage(BigNumber.from(amount), recipient.address, till, secret);
  const signature = ethers.utils.splitSignature(signedMessage);
  return [solution, secret, till, signature.v, signature.r, signature.s];
};

export const apiCall = async (apiUrl: string, apiMethod: string, request: any, authToken?: string) => {
  let responseResult: any;
  try {
    const headers = { "content-type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    console.log(
      `curl -X POST "${apiUrl + "/" + apiMethod}" -d '${JSON.stringify({
        data: request,
      })}' ${Object.keys(headers)
        .map(key => `-H "${key}: ${headers[key]}"`)
        .join(" ")}`,
    );
    const { status, data } = await axios.post(
      `${apiUrl + "/" + apiMethod}/`,
      {
        data: request,
      },
      { headers },
    );
    console.log(`INFO: ${apiMethod} response`);
    console.log("INFO: --  response status", status);
    console.log("INFO: --  response data", JSON.stringify(data));
    responseResult = data.result;
  } catch (e) {
    console.log(e);
    throw e;
  }
  return responseResult;
};

export function createFundingScenario(
  deployedNetworks: string[],
  networkScenarios: INetworkScenarios,
): INetworkScenarios {
  let completeScenario: INetworkScenarios = {};
  const emptyBalance: IScenario = {
    usdc: BigNumber.from("0"),
    sedn: BigNumber.from("0"),
  };
  for (const network of deployedNetworks) {
    if (network in networkScenarios) {
      completeScenario[network] = networkScenarios[network];
    } else {
      completeScenario[network] = emptyBalance;
    }
  }
  return completeScenario;
}

export const instantiateFundingScenario = async (
  fundingScenarios: INetworkScenarios,
  sednVars: { [network: string]: any },
) => {
  let usdcBalanceUnfundedBefore: BigNumber;
  let usdcBalanceUnfundedTarget: BigNumber;
  let sednBalanceUnfundedBefore: BigNumber;
  let sednBalanceUnfundedTarget: BigNumber;
  let usdcDifference: BigNumber;
  let sednDifference: BigNumber;
  let tx: TransactionResponse;
  const zeroBig: BigNumber = BigNumber.from(0);
  const minusOneBig: BigNumber = BigNumber.from("-1");
  // check and potentially fund USDC on unfundedSigner for EOA
  console.log(`INFO: Checking and potentially adapting USDC EOA Balances for Target Values according to Scenarios...`);
  for (const network of Object.keys(fundingScenarios)) {
    usdcBalanceUnfundedBefore = await sednVars[network].usdcOrigin
      .connect(sednVars[network].unfundedSigner)
      .balanceOf(sednVars[network].unfundedSigner.address);
    usdcBalanceUnfundedTarget = fundingScenarios[network].usdc;
    usdcDifference = usdcBalanceUnfundedTarget.sub(usdcBalanceUnfundedBefore); // positive means we need to add funds, negative means we need to remove funds
    if (usdcDifference.toString() != "0") {
      console.log(
        `INFO: Funding unfundedSigner on ${network} with ${usdcBalanceUnfundedTarget} USDC on EOA...diff ${usdcDifference.toString()}`,
      );
      if (usdcDifference.lt(zeroBig)) {
        tx = await sednVars[network].usdcOrigin
          .connect(sednVars[network].unfundedSigner)
          .transfer(sednVars[network].signer.address, usdcDifference.mul(minusOneBig));
        const nonce = (await sednVars[network].unfundedSigner.getTransactionCount()) + 1;
        tx.nonce = nonce;
        console.log(`INFO: Sending tx with nonce ${nonce} and ${network}/${tx.hash}`);
        await tx.wait();
        console.log(`INFO: Executed tx waiting for balance to change`);
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[network].usdcOrigin,
          sednVars[network].unfundedSigner,
          usdcBalanceUnfundedBefore,
        );
      } else {
        tx = await sednVars[network].usdcOrigin
          .connect(sednVars[network].signer)
          .transfer(sednVars[network].unfundedSigner.address, usdcDifference);
        const nonce = (await sednVars[network].signer.getTransactionCount()) + 1;
        tx.nonce = nonce;
        console.log(`INFO: Sending tx with nonce ${nonce} and ${network}/${tx.hash}`);
        await tx.wait();
        console.log(`INFO: Executed tx waiting for balance to change`);
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[network].usdcOrigin,
          sednVars[network].unfundedSigner,
          usdcBalanceUnfundedBefore,
        );
      }
    }
    console.log(
      `INFO: Successful funding of unfundedSigner on ${network} with ${usdcBalanceUnfundedTarget} USDC on EOA`,
    );
  }
  // check and potentially fund USDC on unfundedRecipient for Sedn
  console.log(`INFO: Checking and potentially adapting USDC Sedn Balances for Target Values according to Scenarios...`);
  for (const network of Object.keys(fundingScenarios)) {
    sednBalanceUnfundedBefore = await sednVars[network].sedn
      .connect(sednVars[network].unfundedSigner)
      .balanceOf(sednVars[network].unfundedSigner.address);
    sednBalanceUnfundedTarget = fundingScenarios[network].sedn;
    sednDifference = sednBalanceUnfundedTarget.sub(sednBalanceUnfundedBefore); // positive means we need to add funds, negative means we need to remove funds
    if (sednDifference.toString() != "0") {
      console.log(
        `INFO: funding unfundedSigner on ${network} with ${sednBalanceUnfundedTarget} USDC on Sedn... (diff ${sednDifference.toString()}))`,
      );
      if (sednDifference.lt(zeroBig)) {
        tx = await sednVars[network].sedn
          .connect(sednVars[network].unfundedSigner)
          .transferKnown(sednDifference.mul(minusOneBig), sednVars[network].signer.address);
        const nonce = (await sednVars[network].unfundedSigner.getTransactionCount()) + 1;
        tx.nonce = nonce;
        console.log(`INFO: Sending tx with nonce ${nonce} and ${network}/${tx.hash}`);
        await tx.wait();
        console.log(`INFO: Executed tx waiting for balance to change`);
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[network].sedn,
          sednVars[network].unfundedSigner,
          sednBalanceUnfundedBefore,
        );
      } else {
        await checkAllowance(
          sednVars[network].usdcOrigin,
          sednVars[network].signer,
          sednVars[network].sedn,
          sednDifference,
        );
        tx = await sednVars[network].sedn
          .connect(sednVars[network].signer)
          .sednKnown(sednDifference, sednVars[network].unfundedSigner.address);
        const nonce = (await sednVars[network].signer.getTransactionCount()) + 1;
        tx.nonce = nonce;
        console.log(`INFO: Sending tx with nonce ${nonce} and ${network}/${tx.hash}`);
        await tx.wait();
        console.log(`INFO: Executed tx waiting for balance to change`);
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[network].sedn,
          sednVars[network].unfundedSigner,
          sednBalanceUnfundedBefore,
        );
      }
    }
    console.log(
      `INFO: Successful funding of unfundedSigner on ${network} with ${sednBalanceUnfundedTarget} USDC on Sedn`,
    );
  }
  return true;
};

export const handleTxSignature = async (
  transaction: ITransaction,
  sednVars: { [network: string]: any },
  signerName: string,
) => {
  const network = getChainFromId(transaction.chainId);
  const method = transaction.method;
  const sednContract = sednVars[network].sedn;
  const signer = sednVars[network][signerName];
  let args: any = transaction.args;
  const value = BigInt(transaction.value);
  const forwarderAddress = sednVars[network].forwarder;
  let amount = BigNumber.from(0);
  if ("_amount" in transaction.args) {
    amount = BigNumber.from(transaction.args._amount);
  }
  // check what's what
  switch (method) {
    case "sednKnown":
      console.log("INFO: sednKnown; allowance needs to be adjusted.");
      await checkAllowance(sednVars[network].usdcOrigin, sednVars[network][signerName], sednVars[network].sedn, amount);
      args = { _amount: amount, to: args.to };
      break;
    case "sednUnknown":
      console.log("INFO: sednUnknown; allowance needs to be adjusted.");
      await checkAllowance(sednVars[network].usdcOrigin, sednVars[network][signerName], sednVars[network].sedn, amount);
      args = { _amount: amount, secret: args.secret };
      break;
    case "transferKnown":
      console.log("INFO: transferKnown");
      args = { _amount: amount, secret: args.to };
      break;
    case "transferUnknown":
      console.log("INFO: transferUnknown");
      args = { _amount: amount, secret: args.secret };
      break;
    case "hybridKnown":
      console.log("INFO: hybridKnown; allowance needs to be adjusted.");
      await checkAllowance(sednVars[network].usdcOrigin, sednVars[network][signerName], sednVars[network].sedn, amount);
      args = { _amount: amount, balanceAmount: args.balanceAmount, to: args.to };
      break;
    case "hybridUnknown":
      console.log("INFO: hybridUnknown; allowance needs to be adjusted.");
      console.log(
        "INFO: usdcOrigin.address ",
        sednVars[network].usdcOrigin.address,
        " signer.address ",
        sednVars[network][signerName].address,
        "sedn.address: ",
        sednVars[network].sedn.address,
        "amount: ",
        amount.toString(),
        "amount:",
        amount.toString(),
      );
      await checkAllowance(sednVars[network].usdcOrigin, sednVars[network][signerName], sednVars[network].sedn, amount);
      args = { _amount: amount, balanceAmount: args.balanceAmount, secret: args.secret };
      break;
    case "withdraw":
      console.log("INFO: withdraw");
      args = { _amount: amount, secret: args.to };
      break;
    case "bridgeWithdraw":
      console.log("INFO: bridgeWithdraw");
      break;
    case "claim":
      console.log("INFO: claim");
      break;
    default:
      throw new Error(`Unknown method ${method}`);
  }
  console.log(
    "DEBUG: Method: ",
    method,
    "passed with args: ",
    args,
    "on chain: ",
    network,
    "to contract:",
    sednContract.address,
    "with signer: ",
    signer.address,
    "and value: ",
    value,
    "and forwarder: ",
    forwarderAddress,
  );
  const signedRequest = await getSignedTxRequest(
    sednContract,
    signer,
    signer.privateKey,
    method,
    Object.values(args),
    value,
    forwarderAddress,
  );
  return JSON.stringify(signedRequest);
};

export const getBalance = async (contract: Contract, signer: Wallet) => {
  const balance = await contract.connect(signer).balanceOf(signer.address);
  const balanceStr = balance.toString();
  return balanceStr;
};
